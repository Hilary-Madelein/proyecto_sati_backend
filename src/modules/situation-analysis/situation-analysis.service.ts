import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { GeminiClient } from '../../integrations/gemini/gemini.client.js';
import { CantonAnalysisService } from '../canton-analysis/canton-analysis.service.js';
import { loadParishes, type ParishPoint } from '../canton-analysis/parishes.js';
import { FLOOD_HAZARD_TYPES } from '../events/domain/hazard-type.js';
import { EventsService } from '../events/events.service.js';
import { FloodHubService } from '../flood-hub/flood-hub.service.js';
import { WeatherStationsService } from '../weather-stations/weather-stations.service.js';
import { EVENT_HOURS, NATIONAL_SCOPE, buildFacts, provinceScope, sameProvince, type SituationFacts, type SituationScope } from './situation-facts.js';
import {
  ANSWER_SCHEMA,
  QUESTION_MAX_LENGTH,
  QUESTION_SYSTEM,
  SITUATION_SCHEMA,
  SITUATION_SYSTEM,
  inventedNumbers,
  isAnswerAcceptable,
  isTooLong,
  plainText,
  questionPrompt,
  situationPrompt,
  templateText,
  type SituationText,
} from './situation-text.js';

const MINUTE_MS = 60 * 1000;
/** Un análisis sirve este tiempo para el mismo lugar: los datos cambian cada hora, y así muchos pedidos gastan una sola consulta. */
const AI_TTL_MS = 15 * MINUTE_MS;
/** El texto de plantilla dura poco: se vuelve a intentar con Gemini enseguida. */
const TEMPLATE_TTL_MS = 2 * MINUTE_MS;
const MAX_ENTRIES = 300;
/** Tope de consultas a Gemini por hora, por si alguien pide análisis sin parar: pasado el tope, sale la plantilla. */
const MAX_AI_CALLS_PER_HOUR = 90;
const HOUR_MS = 60 * MINUTE_MS;

const SOURCES = 'INAMHI, SNGR, GEOGLOWS y Google Flood Hub';
const AI_NOTE = 'Texto redactado con inteligencia artificial a partir de los datos del sistema. No reemplaza los avisos oficiales de la SNGR ni del INAMHI.';
const TEMPLATE_NOTE = 'Resumen automático de los datos del sistema. No reemplaza los avisos oficiales de la SNGR ni del INAMHI.';

export interface SituationAnalysis extends SituationText {
  /** Lugar analizado, como se nombra tras "en": "Ecuador", "la provincia de Manabí". */
  place: string;
  generatedAt: string;
  /** Hora de los datos, ya escrita para mostrar (hora del Ecuador). */
  dataTime: string;
  /** Quién redactó: Gemini o, si no respondió, la plantilla. */
  writer: 'ai' | 'template';
  model: string | null;
  sources: string;
  note: string;
  /** Lo que no se pudo leer al generarlo. */
  missing: string[];
}

/** Respuesta a una pregunta sobre el análisis. */
export interface SituationAnswer {
  answer: string;
  note: string;
}

/** El análisis y los datos con que se hizo: las preguntas se responden con esos mismos datos. */
interface Prepared {
  analysis: SituationAnalysis;
  facts: SituationFacts;
}

interface Entry {
  expiresAt: number;
  value: Promise<Prepared>;
}

/**
 * Análisis de la situación del momento, a pedido: junta lo que el sistema ya
 * calcula (pronóstico por parroquia, lluvia medida, crecidas de Google, ríos y
 * eventos de la SNGR), y Gemini lo redacta. Gemini no decide niveles ni cifras; si
 * no responde o escribe una cifra que no está en los datos, sale el texto de plantilla.
 */
@Injectable()
export class SituationAnalysisService {
  private readonly logger = new Logger(SituationAnalysisService.name);
  private readonly entries = new Map<string, Entry>();
  private parishes: Promise<ParishPoint[]> | null = null;
  private aiCalls: number[] = [];

  constructor(
    private readonly analysis: CantonAnalysisService,
    private readonly stations: WeatherStationsService,
    private readonly floodHub: FloodHubService,
    private readonly events: EventsService,
    private readonly gemini: GeminiClient,
  ) {}

  /** Del país, o de una provincia por su nombre (con o sin tildes y mayúsculas). */
  async forProvince(province?: string): Promise<SituationAnalysis> {
    return this.analyze(await this.scopeOf(province));
  }

  /**
   * Responde una pregunta sobre el análisis de un lugar con los mismos datos. El
   * límite de preguntas por persona lo pone el visor; aquí cuentan para el tope
   * de consultas por hora. Si la IA no puede responder bien, se dice, no se improvisa.
   */
  async ask(province: string | undefined, question: string | undefined): Promise<SituationAnswer> {
    const text = question?.replace(/\s+/g, ' ').trim() ?? '';
    if (text.length < 3) throw new BadRequestException('Escribe una pregunta');
    if (text.length > QUESTION_MAX_LENGTH) throw new BadRequestException(`La pregunta puede tener hasta ${QUESTION_MAX_LENGTH} caracteres`);
    const { analysis, facts } = await this.prepared(await this.scopeOf(province));
    const unavailable = new ServiceUnavailableException('El asistente no pudo responder en este momento. Intenta de nuevo en unos minutos');
    if (!this.gemini.enabled || !this.takeAiCall()) throw unavailable;
    try {
      const { value } = await this.gemini.generateJson<{ answer: string }>({
        system: QUESTION_SYSTEM,
        prompt: questionPrompt(facts, analysis, text),
        schema: ANSWER_SCHEMA,
      });
      const answer = plainText(value.answer);
      if (isAnswerAcceptable(answer, facts, text)) return { answer, note: AI_NOTE };
      this.logger.warn(`Respuesta sobre ${facts.lugar} descartada: cifras que no están en los datos o demasiado larga`);
    } catch (error) {
      this.logger.warn(`Pregunta sobre ${facts.lugar} sin respuesta: ${(error as Error).message}`);
    }
    throw unavailable;
  }

  private async scopeOf(province?: string): Promise<SituationScope> {
    if (!province?.trim()) return NATIONAL_SCOPE;
    const name = [...new Set((await this.parishPoints()).map((parish) => parish.province))].find((item) => sameProvince(item, province));
    if (!name) throw new NotFoundException(`No se reconoce la provincia "${province}"`);
    return provinceScope(name);
  }

  /** El análisis de un ámbito; los pedidos del mismo lugar comparten el resultado mientras dure. */
  async analyze(scope: SituationScope): Promise<SituationAnalysis> {
    return (await this.prepared(scope)).analysis;
  }

  private prepared(scope: SituationScope): Promise<Prepared> {
    const hit = this.entries.get(scope.key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    if (this.entries.size >= MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    const entry: Entry = { expiresAt: Date.now() + AI_TTL_MS, value: this.generate(scope) };
    this.entries.delete(scope.key);
    this.entries.set(scope.key, entry);
    entry.value.then(
      ({ analysis }) => {
        if (analysis.writer === 'template') entry.expiresAt = Date.now() + TEMPLATE_TTL_MS;
      },
      () => this.entries.delete(scope.key),
    );
    return entry.value;
  }

  private async generate(scope: SituationScope): Promise<Prepared> {
    const now = new Date();
    const facts = await this.loadFacts(scope, now);
    const written = await this.write(facts);
    const analysis: SituationAnalysis = {
      place: scope.label,
      generatedAt: now.toISOString(),
      dataTime: facts.horaDeLosDatos,
      ...(written?.text ?? templateText(facts)),
      writer: written ? 'ai' : 'template',
      model: written?.model ?? null,
      sources: SOURCES,
      note: written ? AI_NOTE : TEMPLATE_NOTE,
      missing: facts.datosNoDisponibles,
    };
    return { analysis, facts };
  }

  /** Cada fuente por separado: la que falle queda anotada y el análisis sale con las demás. */
  private async loadFacts(scope: SituationScope, now: Date): Promise<SituationFacts> {
    const attempt = <T>(load: () => Promise<T>): Promise<T | null> => load().catch(() => null);
    const [parishPoints, analysis, stations, floodHub, events] = await Promise.all([
      this.parishPoints(),
      attempt(() => this.analysis.snapshot()),
      attempt(() => this.stations.snapshot()),
      attempt(() => this.floodHub.snapshot()),
      attempt(async () => {
        const from = new Date(now.getTime() - EVENT_HOURS * HOUR_MS);
        return (await this.events.list({ from, to: now, hazardTypes: [...FLOOD_HAZARD_TYPES] }, { limit: 1000, offset: 0 })).items;
      }),
    ]);
    return buildFacts(scope, { now, parishPoints, analysis, stations, flashFloods: floodHub?.flashFloods ?? null, events });
  }

  /** Lo redacta Gemini; null si no hay clave, no responde, se pasó el tope o el texto trae una cifra que no está en los datos. */
  private async write(facts: SituationFacts): Promise<{ text: SituationText; model: string } | null> {
    if (!this.gemini.enabled || !this.takeAiCall()) return null;
    try {
      const { value, model } = await this.gemini.generateJson<SituationText>({
        system: SITUATION_SYSTEM,
        prompt: situationPrompt(facts),
        schema: SITUATION_SCHEMA,
      });
      const text: SituationText = {
        headline: plainText(value.headline),
        observed: plainText(value.observed),
        expected: plainText(value.expected),
        meaning: plainText(value.meaning),
      };
      const invented = inventedNumbers(text, facts);
      if (invented.length > 0) {
        this.logger.warn(`Análisis de ${facts.lugar} descartado: cifras que no están en los datos (${invented.join(', ')})`);
        return null;
      }
      if (isTooLong(text)) {
        this.logger.warn(`Análisis de ${facts.lugar} descartado: demasiado largo`);
        return null;
      }
      return { text, model };
    } catch (error) {
      this.logger.warn(`Análisis de ${facts.lugar} sin IA: ${(error as Error).message}`);
      return null;
    }
  }

  private takeAiCall(): boolean {
    const since = Date.now() - HOUR_MS;
    this.aiCalls = this.aiCalls.filter((time) => time > since);
    if (this.aiCalls.length >= MAX_AI_CALLS_PER_HOUR) return false;
    this.aiCalls.push(Date.now());
    return true;
  }

  private parishPoints(): Promise<ParishPoint[]> {
    return (this.parishes ??= loadParishes());
  }
}
