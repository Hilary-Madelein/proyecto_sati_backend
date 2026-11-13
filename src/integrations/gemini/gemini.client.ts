import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';

/** Tiempo límite por modelo: uno saturado a veces no contesta nunca, y lo normal son 1 a 6 s. */
const ATTEMPT_TIMEOUT_MS = 8_000;

/** Esquema de la respuesta, en el formato de Gemini (tipos en mayúsculas). */
export interface GeminiSchema {
  type: 'OBJECT';
  properties: Record<string, { type: 'STRING'; description?: string }>;
  required: string[];
}

export interface GeminiRequest {
  /** Instrucciones fijas: el papel y las reglas de redacción. */
  system: string;
  /** Lo que cambia en cada pedido: los datos. */
  prompt: string;
  schema: GeminiSchema;
}

/** Falla de Gemini. Nunca incluye la clave: va en una cabecera, que no se registra. */
export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

interface GenerateResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  error?: { message?: string; status?: string };
}

/** Cliente mínimo de la API de Gemini: pide un texto con forma de JSON. */
@Injectable()
export class GeminiClient {
  private readonly logger = new Logger(GeminiClient.name);
  private readonly key: string | undefined;
  private readonly models: string[];
  private readonly url: string;

  constructor(config: AppConfigService) {
    this.key = config.get('GEMINI_API_KEY');
    this.models = config.get('GEMINI_MODELS');
    this.url = config.get('GEMINI_API_URL').replace(/\/+$/, '');
  }

  /** false = sin GEMINI_API_KEY. */
  get enabled(): boolean {
    return Boolean(this.key) && this.models.length > 0;
  }

  /** Prueba los modelos en orden y devuelve la primera respuesta válida. */
  async generateJson<T>(request: GeminiRequest): Promise<{ value: T; model: string }> {
    if (!this.enabled) throw new GeminiError('falta GEMINI_API_KEY');
    let last = 'sin modelos';
    for (const model of this.models) {
      try {
        return { value: await this.callModel<T>(model, request), model };
      } catch (error) {
        last = `${model}: ${(error as Error).message}`;
        this.logger.warn(`Gemini no respondió (${last})`);
      }
    }
    throw new GeminiError(last);
  }

  /** Sin razonamiento previo si el modelo lo admite; los que no (los "lite") responden 400 y se repite sin ese ajuste. */
  private async callModel<T>(model: string, request: GeminiRequest): Promise<T> {
    try {
      return await this.call<T>(model, request, true);
    } catch (error) {
      if (!(error instanceof GeminiError) || error.status !== 400) throw error;
      return this.call<T>(model, request, false);
    }
  }

  private async call<T>(model: string, { system, prompt, schema }: GeminiRequest, noThinking: boolean): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.url}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.key! },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json',
            responseSchema: schema,
            // Solo redacta datos ya calculados: sin razonamiento previo responde en 1 a 2 s en vez de 6.
            ...(noThinking && { thinkingConfig: { thinkingBudget: 0 } }),
          },
        }),
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      });
    } catch (error) {
      throw new GeminiError((error as Error).name === 'TimeoutError' ? `sin respuesta en ${ATTEMPT_TIMEOUT_MS / 1000} s` : 'no se pudo conectar');
    }
    const body = (await response.json().catch(() => null)) as GenerateResponse | null;
    if (!response.ok) throw new GeminiError(`HTTP ${response.status}${body?.error?.status ? ` ${body.error.status}` : ''}`, response.status);

    const candidate = body?.candidates?.[0];
    const text = candidate?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
    if (!text) throw new GeminiError(`respuesta vacía (${candidate?.finishReason ?? 'sin candidato'})`);
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new GeminiError('la respuesta no es JSON');
    }
    for (const field of schema.required) {
      const content = (value as Record<string, unknown> | null)?.[field];
      if (typeof content !== 'string' || !content.trim()) throw new GeminiError(`falta el campo "${field}"`);
    }
    return value as T;
  }
}
