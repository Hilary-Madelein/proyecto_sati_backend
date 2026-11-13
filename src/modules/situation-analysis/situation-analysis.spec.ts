import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeminiClient } from '../../integrations/gemini/gemini.client.js';
import type { CantonAnalysisService, CantonAnalysisSnapshot } from '../canton-analysis/canton-analysis.service.js';
import type { ParishPoint } from '../canton-analysis/parishes.js';
import type { HazardEventEntity } from '../events/entities/hazard-event.entity.js';
import type { EventsService } from '../events/events.service.js';
import type { FloodHubService } from '../flood-hub/flood-hub.service.js';
import type { FlashFloodArea } from '../flood-hub/flood-hub-source.js';
import type { WeatherStationsService, WeatherStationsSnapshot } from '../weather-stations/weather-stations.service.js';
import { NATIONAL_SCOPE, buildFacts, provinceScope, provincesScope, type SituationInputs } from './situation-facts.js';
import { SituationAnalysisService } from './situation-analysis.service.js';
import { inventedNumbers, numbersIn, plainText, templateText, type SituationText } from './situation-text.js';

const PARISHES: ParishPoint[] = [
  { code: '130301', name: 'Chone', cantonCode: '1303', canton: 'Chone', province: 'Manabí', kind: 'cabecera', lat: -0.7, lng: -80.1 },
  { code: '130302', name: 'Canuto', cantonCode: '1303', canton: 'Chone', province: 'Manabí', kind: 'rural', lat: -0.8, lng: -80.2 },
  { code: '090101', name: 'Guayaquil', cantonCode: '0901', canton: 'Guayaquil', province: 'Guayas', kind: 'cabecera', lat: -2.2, lng: -79.9 },
];

vi.mock('../canton-analysis/parishes.js', () => ({ loadParishes: async () => PARISHES }));

const NOW = new Date('2026-11-13T20:00:00Z');

const parish = (point: ParishPoint, semaphore: string, categoryLabel: string, mm24h: number, decidedBy = '24h') => ({
  code: point.code,
  name: point.name,
  canton: point.canton,
  cantonCode: point.cantonCode,
  province: point.province,
  kind: point.kind,
  point: [point.lat, point.lng],
  semaphore,
  category: categoryLabel.toLowerCase(),
  categoryLabel,
  forecast: { mm3h: 12.4, mm6h: null, mm12h: null, mm24h, category24h: categoryLabel.toLowerCase() },
  decidedBy,
});

const canton = (code: string, name: string, province: string, riverAlerts: number, riverMaxLevel: number) => ({
  code,
  name,
  province,
  triggers: { riverAlerts, riverMaxLevel, floodHubFlagged: 0, sngrEvents: 0, criticalPoints: 0 },
  exposed: { floodTowns: 4, schools: 30, schoolsHighFlood: 12, students: 5210, healthCenters: 9, healthFloodSusceptible: 0, bridges: 6, bridgesBad: 1, rveKm: 80.4, rveCautionKm: 0 },
  preventive: { actions: 2, enosWorksActive: 0, culverts: 0 },
  response: { shelters: 3, sheltersActive: 0, provinceMachinery: 15, camps: 1, roadEventsOpen: 0, responseActions: 0 },
});

const analysis = {
  updatedAt: NOW.toISOString(),
  forecast24h: { from: '2026-11-13T18:00:00Z', to: '2026-11-14T18:00:00Z' },
  // De la más a la menos afectada, como las entrega el servicio.
  parishes: [parish(PARISHES[0], 'red', 'Torrencial', 118.6), parish(PARISHES[1], 'orange', 'Intensa', 62.2), parish(PARISHES[2], 'yellow', 'Moderada', 14)],
  // La capa de cantones trae las provincias sin tilde.
  cantons: [canton('1303', 'Chone', 'Manabi', 7, 5), canton('0901', 'Guayaquil', 'Guayas', 2, 2)],
  sources: [
    { name: 'Alertas por caudal', ok: true, detail: '' },
    { name: 'Índice de preparación', ok: false, detail: 'falló' },
  ],
  provinces: [
    { name: 'Guayas', level: 'high' },
    { name: 'Manabi', level: 'low' },
  ],
} as unknown as CantonAnalysisSnapshot;

const stations = {
  windowHours: 24,
  stations: [
    { name: 'CHONE-U.CATOLICA', lat: -0.69, lng: -80.09, totalMm: 85.3, hoursWithData: 24 },
    { name: 'POCAS HORAS', lat: -0.7, lng: -80.1, totalMm: 200, hoursWithData: 2 },
    { name: 'GUAYAQUIL', lat: -2.2, lng: -79.9, totalMm: 0.4, hoursWithData: 20 },
    { name: 'EN EL MAR', lat: -1, lng: -89, totalMm: 30, hoursWithData: 24 },
  ],
} as unknown as WeatherStationsSnapshot;

const flashFlood: FlashFloodArea = {
  id: 'a',
  likelihood: 'highly_likely',
  issuedAt: '2026-11-13T12:00:00Z',
  validUntil: '2026-11-14T12:00:00Z',
  countries: ['EC'],
  geometry: { type: 'MultiPolygon', coordinates: [[[[-80.5, -0.5], [-79.9, -0.5], [-79.9, -0.75], [-80.5, -0.75], [-80.5, -0.5]]]] },
};

const event = (province: string, cantonName: string, severity: string, hasDamage: boolean, affected: number) =>
  ({
    province,
    canton: cantonName,
    severity,
    hasDamage,
    affected,
    hazardType: 'river_flood',
    occurredAt: new Date('2026-11-13T15:00:00Z'),
    location: { type: 'Point', coordinates: [-80.1, -0.7] },
  }) as unknown as HazardEventEntity;

const events = [event('MANABÍ', 'CHONE', 'critical', true, 40), event('GUAYAS', 'GUAYAQUIL', 'moderate', false, 0)];

const inputs: SituationInputs = { now: NOW, parishPoints: PARISHES, analysis, stations, flashFloods: [flashFlood], events };

describe('datos del análisis de la situación', () => {
  it('de una provincia toma solo lo suyo, con las cifras redondeadas', () => {
    const facts = buildFacts(provinceScope('Manabí'), inputs);
    expect(facts.lugar).toBe('la provincia de Manabí');
    expect(facts.pronosticoDeLluvia).toMatchObject({ parroquiasConPronostico: 2, parroquiasEnAlertaMuyAlta: 1, parroquiasEnAlertaAlta: 1, parroquiasEnAlertaModerada: 0 });
    expect(facts.pronosticoDeLluvia?.lugaresConMasLluviaEsperada[0]).toEqual({
      parroquia: 'Chone',
      canton: 'Chone',
      provincia: 'Manabí',
      lluviaMm: 119,
      enLasProximasHoras: 24,
      categoriaDeLluvia: 'torrencial',
      umbralDeEsaCategoriaMm: 100,
      comparacionConElUmbral: 'apenas sobre el umbral',
      lluviaEn24HorasMm: 119,
      categoriaEn24Horas: 'torrencial',
      alerta: 'muy alta',
    });
    expect(facts.pronosticoDeLluvia?.consecuenciasPosiblesSegunLaCategoriaMasAlta).toContain('desbordamientos');
    expect(facts.pronosticoDeLluvia?.provinciasConMasParroquiasEnAlertaAltaOMuyAlta).toBeUndefined();
    // Una estación con pocas horas o lejos de todo no cuenta; 85,3 mm en 24 h es lluvia intensa.
    expect(facts.lluviaMedida).toMatchObject({ estacionesConDatos: 1 });
    expect(facts.lluviaMedida?.estacionesConMasLluvia).toEqual([{ estacion: 'Chone-u.catolica', ubicacion: 'Chone, Manabí', lluviaMm: 85, categoriaDeLluvia: 'intensa' }]);
    expect(facts.crecidasRepentinas).toMatchObject({ cantonesMuyProbable: 1, cantonesProbable: 0, cantones: ['Chone'] });
    // La provincia del cantón viene sin tilde ("Manabi") y se reconoce igual.
    expect(facts.rios).toMatchObject({ tramosDeRioEnAlerta: 7, cantonesConTramosEnAlerta: 1, crecidaMasGrandeUnaVezCadaAnios: 5 });
    expect(facts.inundacionesReportadas).toMatchObject({ total: 1, criticas: 1, conDanios: 1, personasAfectadas: 40 });
    expect(facts.inundacionesReportadas?.masGraves[0]).toMatchObject({ tipo: 'desborde de río', canton: 'Chone', nivel: 'crítico' });
    expect(facts.datosNoDisponibles).toEqual(['Índice de preparación']);
    // El contexto del cantón con más parroquias en alerta: lo que coincide con el pronóstico y lo expuesto.
    expect(facts.cantonesConParroquiasEnAlerta).toEqual([
      {
        canton: 'Chone',
        provincia: 'Manabí',
        parroquiasEnAlertaAltaOMuyAlta: 2,
        senialesQueCoinciden: [
          '85 mm ya medidos en las últimas 24 horas (el suelo ya está mojado)',
          '7 tramos de río en alerta por caudal',
          'crecida repentina muy probable según Google (no confirmada por la SNGR)',
        ],
        respaldoDeLaAlerta: 'reforzada por varias señales',
        expuesto: [
          '4 poblaciones propensas a inundaciones',
          '12 instituciones educativas con susceptibilidad alta a inundación',
          '1 puente en mal estado',
        ],
        recursos: ['3 alojamientos temporales'],
      },
    ]);
  });

  it('del país suma todo y reparte por provincia', () => {
    const facts = buildFacts(NATIONAL_SCOPE, inputs);
    expect(facts.pronosticoDeLluvia).toMatchObject({ parroquiasConPronostico: 3, parroquiasEnAlertaModerada: 1 });
    expect(facts.rios?.tramosDeRioEnAlerta).toBe(9);
    // Del país: sumas de todos los cantones, la maquinaria una vez por provincia y sin comparación entre provincias.
    expect(facts.vulnerabilidadYPreparacion).toMatchObject({
      expuesto: { poblacionesPropensasAInundaciones: 8, estudiantesEnEsasInstituciones: 10420, kmDeRedVialEstatal: 161 },
      preparacion: { alojamientosTemporales: 6, equiposDeMaquinariaPesada: 30 },
    });
    expect(facts.vulnerabilidadYPreparacion?.lectura).toBeUndefined();
    expect(facts.inundacionesReportadas?.total).toBe(2);
    expect(facts.crecidasRepentinas?.cantones).toEqual(['Chone (Manabí)']);
  });

  it('de varias provincias toma lo de todas, en cualquier orden, y reparte por provincia', () => {
    const scope = provincesScope(['Manabí', 'loja']);
    expect(scope).toMatchObject({ label: 'las provincias de loja y Manabí', severalProvinces: true });
    expect(provincesScope(['Loja', 'MANABI']).key).toBe(scope.key);
    expect(scope.includes({ cantonCode: 'x', province: 'LOJA' })).toBe(true);
    expect(scope.includes({ cantonCode: 'x', province: 'Guayas' })).toBe(false);
    // Una sola es la provincia (comparte la caché con el pedido de esa provincia).
    expect(provincesScope(['Manabí'])).toMatchObject({ key: provinceScope('Manabí').key, severalProvinces: false });
    const facts = buildFacts(scope, inputs);
    expect(facts.lugar).toBe('las provincias de loja y Manabí');
    expect(facts.crecidasRepentinas?.cantones).toEqual(['Chone (Manabí)']);
  });

  it('lo que no se pudo leer queda anotado, no supuesto', () => {
    const facts = buildFacts(NATIONAL_SCOPE, { ...inputs, analysis: null, stations: null, flashFloods: null, events: null });
    expect(facts.pronosticoDeLluvia).toBeNull();
    expect(facts.rios).toBeNull();
    expect(facts.datosNoDisponibles).toEqual(['Pronóstico de lluvia', 'Capas de exposición y respuesta', 'Lluvia medida en estaciones', 'Crecidas repentinas de Google', 'Eventos de la SNGR']);
  });

  it('una crecida de Google vencida no cuenta', () => {
    const facts = buildFacts(NATIONAL_SCOPE, { ...inputs, flashFloods: [{ ...flashFlood, validUntil: '2026-11-13T19:00:00Z' }] });
    expect(facts.crecidasRepentinas).toMatchObject({ cantonesMuyProbable: 0, cantones: [] });
  });
});

describe('control de cifras', () => {
  const facts = buildFacts(provinceScope('Manabí'), inputs);
  const text = (observed: string): SituationText => ({ headline: 'Lluvia torrencial prevista en Chone.', observed, expected: 'Se prevén 119 mm en 24 horas.', meaning: 'Puede haber desbordes.', vulnerability: 'Hay 4 poblaciones propensas.' });

  it('lee los números con separador de miles y con decimales', () => {
    expect(numbersIn('1.200 personas, 85,5 mm y 3 vías a las 15:00')).toEqual([1200, 85.5, 3, 15, 0]);
  });

  it('acepta las cifras de los datos y los conteos pequeños', () => {
    expect(inventedNumbers(text('La estación midió 85 mm en 24 horas en 2 cantones.'), facts)).toEqual([]);
  });

  it('señala una cifra que no está en los datos', () => {
    expect(inventedNumbers(text('La estación midió 140 mm y hubo 350 afectados.'), facts)).toEqual([140, 350]);
  });
});

describe('texto de plantilla', () => {
  it('arma las cuatro partes con lo que hay', () => {
    const text = templateText(buildFacts(provinceScope('Manabí'), inputs));
    expect(text.headline).toBe('Se prevé lluvia torrencial en la provincia de Manabí: 1 en alerta muy alta y 1 en alerta alta, de 2 parroquias con pronóstico.');
    expect(text.observed).toContain('midió 85 mm en las últimas 24 horas, lluvia de categoría intensa');
    expect(text.observed).toContain('1 inundación en las últimas 24 horas, 1 con daños');
    expect(text.expected).toContain('Chone (cantón Chone): 119 mm en las próximas 24 horas, que apenas supera el umbral de lluvia torrencial para ese periodo (100 mm)');
    expect(text.expected).toContain('crecida repentina en 1 cantón (no confirmado por la SNGR)');
    expect(text.expected).toContain('7 tramos de río');
    expect(text.vulnerability).toBe(
      'La provincia de Manabí tiene 4 poblaciones propensas a inundaciones, 12 instituciones educativas con susceptibilidad alta a inundación y 1 puente en mal estado. ' +
        'Lo expuesto se concentra en Chone. Para responder cuenta con 3 alojamientos temporales y 15 equipos de maquinaria pesada. ' +
        'Frente al país ocupa el puesto 1 de 2 provincias por instituciones educativas con susceptibilidad alta a inundación y puesto 1 de 2 provincias por poblaciones propensas a inundaciones (el puesto 1 es la que más tiene). ' +
        'Su preparación es baja según el índice: puesto 2 de 2 (el 1 es la más preparada). En resumen: exposición alta frente a las demás provincias y preparación baja según el índice.',
    );
    expect(text.meaning).toBe(
      'El cantón con más parroquias en alerta es Chone (2). En Chone la alerta coincide con 85 mm ya medidos en las últimas 24 horas (el suelo ya está mojado), ' +
        '7 tramos de río en alerta por caudal y crecida repentina muy probable según Google (no confirmada por la SNGR), lo que hace más probable que haya afectaciones. ' +
        'En ese cantón hay 4 poblaciones propensas a inundaciones, 12 instituciones educativas con susceptibilidad alta a inundación y 1 puente en mal estado. ' +
        'Puede haber inundaciones potencialmente severas, desbordamientos y afectaciones a infraestructura. Sigue los avisos oficiales de la SNGR y del INAMHI.',
    );
  });

  it('una lluvia corta en una sola parroquia se cuenta como localizada, con su periodo, su umbral y el total del día', () => {
    const point = (index: number): ParishPoint => ({ ...PARISHES[0], code: `1101${index}`, name: `Parroquia ${index}`, cantonCode: '1109', canton: 'Chaguarpamba', province: 'Loja' });
    const calm = Array.from({ length: 30 }, (_, index) => ({ ...parish(point(index), 'green', 'Ligera', 2), forecast: { mm3h: 0.5, mm6h: 1, mm12h: 1.5, mm24h: 2, category24h: 'ligera' } }));
    const burst = { ...parish({ ...point(99), name: 'El Rosario' }, 'orange', 'Intensa', 14.2, '3h'), forecast: { mm3h: 12.4, mm6h: 13, mm12h: 13.5, mm24h: 14.2, category24h: 'moderada' } };
    const facts = buildFacts(provinceScope('Loja'), { ...inputs, analysis: { ...analysis, parishes: [burst, ...calm] } as unknown as CantonAnalysisSnapshot });
    expect(facts.pronosticoDeLluvia).toMatchObject({ extensionDeLaAlerta: 'puntual', categoriaDeLluviaMasAlta: 'intensa', parroquiasConPronostico: 31 });
    expect(facts.pronosticoDeLluvia?.lugaresConMasLluviaEsperada[0]).toMatchObject({
      lluviaMm: 12,
      enLasProximasHoras: 3,
      umbralDeEsaCategoriaMm: 10,
      comparacionConElUmbral: 'apenas sobre el umbral',
      lluviaEn24HorasMm: 14,
      categoriaEn24Horas: 'moderada',
    });
    const text = templateText(facts);
    expect(text.headline).toBe('Se prevé lluvia intensa localizada en la provincia de Loja: 1 en alerta alta, de 31 parroquias con pronóstico.');
    expect(text.expected).toContain('12 mm en las próximas 3 horas, que apenas supera el umbral de lluvia intensa para ese periodo (10 mm)');
    expect(text.expected).toContain('En 24 horas se esperan allí 14 mm, categoría moderada.');
    expect(facts.cantonesConParroquiasEnAlerta[0]).toMatchObject({ canton: 'Chaguarpamba', senialesQueCoinciden: [], respaldoDeLaAlerta: 'señal aislada: solo el pronóstico de lluvia' });
    expect(text.meaning).toBe(
      'Es una lluvia localizada, no una situación general del lugar. En Chaguarpamba es una señal aislada: no hay lluvia previa importante, ríos en alerta ni ' +
        'inundaciones recientes que la refuercen, así que pide atención más que alarma. Puede haber inundaciones urbanas, crecidas rápidas y posibles desbordamientos localizados. ' +
        'Sigue los avisos oficiales de la SNGR y del INAMHI.',
    );
  });

  it('sin datos no afirma nada', () => {
    const text = templateText(buildFacts(NATIONAL_SCOPE, { ...inputs, analysis: null, stations: null, flashFloods: null, events: null }));
    expect(text.headline).toContain('No se pudo leer el pronóstico');
    expect(text.observed).toBe('No hay datos medidos disponibles en este momento.');
  });
});

describe('servicio del análisis de la situación', () => {
  const written: SituationText = { headline: 'Lluvia torrencial prevista en Chone.', observed: 'Se midieron 85 mm.', expected: 'Se prevén 119 mm en 24 horas.', meaning: 'Puede haber desbordes.', vulnerability: 'Hay 4 poblaciones propensas.' };
  let generateJson: ReturnType<typeof vi.fn>;
  let gemini: { enabled: boolean; generateJson: ReturnType<typeof vi.fn> };
  let service: SituationAnalysisService;

  beforeEach(() => {
    generateJson = vi.fn(async () => ({ value: written, model: 'modelo-a' }));
    gemini = { enabled: true, generateJson };
    service = new SituationAnalysisService(
      { snapshot: async () => analysis } as unknown as CantonAnalysisService,
      { snapshot: async () => stations } as unknown as WeatherStationsService,
      { snapshot: async () => ({ flashFloods: [flashFlood] }) } as unknown as FloodHubService,
      { list: async () => ({ items: events, total: events.length }) } as unknown as EventsService,
      gemini as unknown as GeminiClient,
    );
  });

  it('entrega lo que redacta Gemini y lo reutiliza para el mismo lugar', async () => {
    const first = await service.forProvince('manabi');
    expect(first).toMatchObject({ place: 'la provincia de Manabí', writer: 'ai', model: 'modelo-a', headline: written.headline });
    expect(generateJson.mock.calls[0][0].prompt).toContain('"lluviaMm": 119');
    await service.forProvince('MANABÍ');
    expect(generateJson).toHaveBeenCalledTimes(1);
    await service.forProvince();
    expect(generateJson).toHaveBeenCalledTimes(2);
  });

  it('si Gemini escribe una cifra que no está en los datos, sale la plantilla', async () => {
    generateJson.mockResolvedValueOnce({ value: { ...written, observed: 'Se midieron 300 mm.' }, model: 'modelo-a' });
    const result = await service.forProvince('Manabí');
    expect(result.writer).toBe('template');
    expect(result.observed).not.toContain('300');
    expect(result.note).toContain('Resumen automático');
  });

  it('si Gemini falla o no hay clave, sale la plantilla', async () => {
    generateJson.mockRejectedValueOnce(new Error('HTTP 503'));
    expect((await service.forProvince('Manabí')).writer).toBe('template');
    gemini.enabled = false;
    expect((await service.forProvince('Guayas')).writer).toBe('template');
    expect(generateJson).toHaveBeenCalledTimes(1);
  });

  it('un texto demasiado largo se descarta y sale la plantilla', async () => {
    generateJson.mockResolvedValueOnce({ value: { ...written, meaning: 'palabra '.repeat(400) }, model: 'modelo-a' });
    expect((await service.forProvince('Manabí')).writer).toBe('template');
  });

  describe('preguntas sobre el análisis', () => {
    it('responde con los datos y el análisis del lugar, sin volver a generarlo', async () => {
      await service.forProvince('Manabí');
      generateJson.mockResolvedValueOnce({ value: { answer: 'En Chone se prevén 119 mm en 24 horas.' }, model: 'modelo-a' });
      const result = await service.ask('manabi', '  ¿Cuánto   lloverá en Chone? ');
      expect(result.answer).toBe('En Chone se prevén 119 mm en 24 horas.');
      expect(generateJson).toHaveBeenCalledTimes(2);
      const { prompt } = generateJson.mock.calls[1][0] as { prompt: string };
      expect(prompt).toContain('"lluviaMm": 119');
      expect(prompt).toContain(written.headline);
      expect(prompt).toContain('Pregunta de la persona:\n¿Cuánto lloverá en Chone?');
    });

    it('no entrega una respuesta con cifras que no están en los datos ni en la pregunta', async () => {
      await service.forProvince('Manabí');
      generateJson.mockResolvedValueOnce({ value: { answer: 'Lloverán 400 mm.' }, model: 'modelo-a' });
      await expect(service.ask('Manabí', '¿Cuánto lloverá?')).rejects.toThrow('no pudo responder');
      generateJson.mockResolvedValueOnce({ value: { answer: 'No, el sistema no prevé 400 mm.' }, model: 'modelo-a' });
      await expect(service.ask('Manabí', '¿Lloverán 400 mm?')).resolves.toMatchObject({ answer: 'No, el sistema no prevé 400 mm.' });
    });

    it('rechaza preguntas vacías o muy largas, y avisa si la IA no está', async () => {
      await expect(service.ask('Manabí', ' ')).rejects.toThrow('Escribe una pregunta');
      await expect(service.ask('Manabí', 'a'.repeat(301))).rejects.toThrow('hasta 300 caracteres');
      gemini.enabled = false;
      await expect(service.ask('Manabí', '¿Qué pasa?')).rejects.toThrow('no pudo responder');
    });
  });

  it('rechaza una provincia que no existe', async () => {
    await expect(service.forProvince('Atlántida')).rejects.toThrow('No se reconoce la provincia');
    await expect(service.forProvince('Manabí,Atlántida')).rejects.toThrow('No se reconoce la provincia "Atlántida"');
  });

  it('analiza varias provincias juntas con su nombre oficial, y comparte el resultado sin importar el orden', async () => {
    const first = await service.forProvince('manabi, guayas');
    expect(first.place).toBe('las provincias de Guayas y Manabí');
    await service.forProvince('Guayas,Manabí');
    expect(generateJson).toHaveBeenCalledTimes(1);
  });
});

describe('plainText', () => {
  it('convierte a letras las tildes que la IA escribe como entidades HTML', () => {
    expect(plainText('Seg&uacute;n el pron&oacute;stico, R&iacute;o Toachi &#8212; Ts&#225;chilas, &Ntilde;')).toBe('Según el pronóstico, Río Toachi — Tsáchilas, Ñ');
  });
  it('deja igual el texto normal y las entidades que no conoce', () => {
    expect(plainText('  Lluvia de 53 mm &raro; ok ')).toBe('Lluvia de 53 mm &raro; ok');
  });
});

describe('withAccents', () => {
  it('pone las tildes a las palabras frecuentes que la IA escribe sin ellas', () => {
    expect(plainText('Segun el pronostico del INAMHI, las lluvias mas altas en las proximas horas alcanzan 53 mm en la parroquia Rio Toachi')).toBe(
      'Según el pronóstico del INAMHI, las lluvias más altas en las próximas horas alcanzan 53 mm en la parroquia Río Toachi',
    );
  });
  it('no toca palabras ya escritas bien ni las que existen sin tilde', () => {
    expect(plainText('Esta lluvia, este río y la categoría están bien.')).toBe('Esta lluvia, este río y la categoría están bien.');
  });
});
