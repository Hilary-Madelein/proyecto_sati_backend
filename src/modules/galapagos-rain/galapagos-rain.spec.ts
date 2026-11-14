import { describe, expect, it, vi } from 'vitest';
import type { AppConfigService } from '../../config/app-config.service.js';
import type { TelegramClient, TelegramMessage } from '../../integrations/telegram/telegram.client.js';
import type { TelegramChatEntity } from '../flood-alerts/entities/telegram-chat.entity.js';
import type { TelegramChatStore } from '../flood-alerts/flood-alert-stores.js';
import type { DeliveryStore } from '../notifications/notification-stores.js';
import type { HourlyRain, StationRainArchive } from '../weather-stations/weather-station-source.js';
import type { WeatherStationsService } from '../weather-stations/weather-stations.service.js';
import { galapagosAlertMessage } from './galapagos-alert-message.js';
import { GalapagosAlertsService, wantsGalapagos } from './galapagos-alerts.service.js';
import { REFERENCE_EVENTS, accumulate, maxByDuration, readRain, type GalapagosLevel } from './galapagos-rain.js';
import { GalapagosRainService } from './galapagos-rain.service.js';

const HOUR_MS = 60 * 60 * 1000;

/** Serie horaria que termina en `end`, con la lluvia dada (la última, la más reciente). */
const series = (values: readonly (number | null)[], end: number): HourlyRain[] =>
  values.map((mm, index) => ({ time: new Date(end - (values.length - 1 - index) * HOUR_MS).toISOString(), mm }));

/** Lluvia medida en Santa Cruz (M0191) del 30/10 03:00 al 31/10 04:00, hora del continente. */
const SANTA_CRUZ = [2.0, 0.0, 0.1, 1.4, 5.7, 3.0, 1.1, 0.8, 1.0, 0.6, 0.0, 0.8, 0.4, 0.0, 24.0, 20.6, 1.5, 0.4, 5.2, 0.3, 24.7, 24.9, 36.8, 34.9, 13.8, 1.6];
/** Lluvia medida en San Cristóbal (M0221) el 12/11, de las 02:00 a las 19:00 de Galápagos. */
const SAN_CRISTOBAL = [7.9, 1.8, 7.7, 5.3, 20.3, 7.6, 10.7, 12.7, 42.1, 7.8, 2.4, 0.9, 1.9, 1.6, 3.7, 0.1, 2.4, 0.0];

/** Nivel hora a hora, como lo vería la alarma: en cada hora, las últimas 24 con dato. */
function replay(values: readonly number[], prior: HourlyRain[] | null = []): GalapagosLevel[] {
  const start = Date.parse('2026-10-30T08:00:00Z');
  return values.map((_, index) => readRain(series(values.slice(Math.max(0, index - 23), index + 1), start + index * HOUR_MS), prior).level);
}

describe('lectura de la lluvia de una estación de Galápagos', () => {
  it('suma hasta la última hora con dato y deja en normal una lluvia corriente', () => {
    const reading = readRain(series([0, 1.3, 11.3, 0.7, 0, 0, 8.0, 3.2, 0.8, null], Date.parse('2026-11-12T18:00:00Z')), []);
    expect(reading).toMatchObject({ lastTime: '2026-11-12T17:00:00.000Z', hoursWithData: 9, mm1h: 0.8, mm3h: 12, mm6h: 12.7, mm24h: 25.3, level: 'normal', reason: null, alarmThresholdMm: 100 });
  });

  it('Santa Cruz, 30 de octubre: alarma al pasar de 100 mm y extrema una hora después, antes del pico', () => {
    const levels = replay(SANTA_CRUZ);
    // Hasta las 23:00 (hora del continente) llevaba 93,6 mm: todavía normal.
    expect(levels.slice(0, 21).every((level) => level === 'normal')).toBe(true);
    // Con la hora de las 00:00 pasa de 100 mm: alarma.
    expect(levels[21]).toBe('alarm');
    // Con la de la 01:00 lleva 86,4 mm en 3 horas: extrema, cuando aún faltaban 48,7 mm por caer.
    expect(levels[22]).toBe('extreme');
    expect(levels[23]).toBe('extreme');
  });

  it('San Cristóbal, 12 de noviembre: alarma, sin llegar a extrema', () => {
    // El día anterior habían caído 54,7 mm, que entran en las 24 horas.
    const levels = replay([13.7, 5.4, 7.6, 3.0, 0.4, 0.3, 0.4, 0.4, 0.1, 0.3, 0.0, ...SAN_CRISTOBAL]);
    expect(levels).toContain('alarm');
    expect(levels).not.toContain('extreme');
    // Salta con la hora de los 12,7 mm, antes de la de 42,1 mm.
    expect(levels.indexOf('alarm')).toBe(11 + 7);
  });

  it('con el suelo cargado la alarma salta con la mitad', () => {
    const end = Date.parse('2026-11-02T20:00:00Z');
    const rain = series([14.6, 8.5, 2.0, 3.0, 4.9, 2.0, 11.0, 5.0], end);
    // Sin lluvia previa, 51 mm en 24 horas no alcanzan.
    expect(readRain(rain, [])).toMatchObject({ mm24h: 51, level: 'normal', loaded: false });
    // Con 250 mm en los tres días anteriores, sí.
    const loaded = readRain(rain, series([120, 80, 50.9], end - 24 * HOUR_MS));
    expect(loaded).toMatchObject({ level: 'alarm', loaded: true, priorMm: 250.9, alarmThresholdMm: 50 });
    expect(loaded.reason).toContain('suelo cargado (250,9 mm en los tres días anteriores)');
    // Si el archivo no se pudo leer, no se supone lluvia previa.
    expect(readRain(rain, null)).toMatchObject({ level: 'normal', priorMm: null, loaded: false });
  });

  it('sin datos queda en normal y lo dice', () => {
    expect(readRain([], [])).toMatchObject({ lastTime: null, hoursWithData: 0, mm24h: 0, level: 'normal' });
  });

  it('los dos episodios de referencia traen sus cifras', () => {
    const [upper, lower] = REFERENCE_EVENTS;
    expect([upper.hourlyMm.length, lower.hourlyMm.length]).toEqual([24, 24]);
    expect(accumulate(upper.hourlyMm).at(-1)).toBe(upper.totalMm);
    expect(accumulate(lower.hourlyMm).at(-1)).toBe(lower.totalMm);
    expect(accumulate([1.5, null, 2])).toEqual([1.5, 1.5, 3.5]);
  });

  it('la lluvia máxima según la duración sale de la serie horaria y coincide con las cifras de cada episodio', () => {
    expect(maxByDuration([1, 5, null, 4, 2])).toEqual([5, 6, 9, 11, 12]);
    const [upper, lower] = REFERENCE_EVENTS.map(({ hourlyMm }) => maxByDuration(hourlyMm));
    // Santa Cruz, 30-31/10: 36,8 mm en 1 h; 96,6 en 3; 136,7 en 6; 188,7 en 12; 203,6 en 24.
    expect([upper[0], upper[2], upper[5], upper[11], upper[23]]).toEqual([36.8, 96.6, 136.7, 188.7, 203.6]);
    // San Cristóbal, 12/11: 42,1 mm en 1 h; 65,5 en 3; 101,2 en 6; 127,2 en 12; 160,7 en 24.
    expect([lower[0], lower[2], lower[5], lower[11], lower[23]]).toEqual([42.1, 65.5, 101.2, 127.2, 160.7]);
    // Desde las 2 horas, el borde superior queda siempre por encima del inferior.
    expect(upper.slice(1).every((mm, index) => mm > lower[index + 1])).toBe(true);
  });
});

describe('a quién se avisa', () => {
  const chat = (scope: Partial<Pick<TelegramChatEntity, 'zones' | 'provinces' | 'cantons'>>) => ({ zones: [], provinces: [], cantons: [], ...scope });

  it('todo el país, la provincia (con o sin tilde), su zona o el cantón', () => {
    expect(wantsGalapagos(chat({}), '2003')).toBe(true);
    expect(wantsGalapagos(chat({ provinces: ['Galapagos'] }), '2003')).toBe(true);
    expect(wantsGalapagos(chat({ zones: [5] }), '2003')).toBe(true);
    expect(wantsGalapagos(chat({ cantons: [{ code: '2003', name: 'Santa Cruz', province: 'Galápagos' }] }), '2003')).toBe(true);
  });

  it('quien eligió otro lugar, u otro cantón de Galápagos, no recibe el de este', () => {
    expect(wantsGalapagos(chat({ provinces: ['Manabí'] }), '2003')).toBe(false);
    expect(wantsGalapagos(chat({ zones: [4] }), '2003')).toBe(false);
    expect(wantsGalapagos(chat({ cantons: [{ code: '2001', name: 'San Cristóbal', province: 'Galápagos' }] }), '2003')).toBe(false);
  });
});

describe('alarma de Galápagos por Telegram', () => {
  const NOW = new Date('2026-10-31T06:00:00Z');
  const station = (code: string, id: number, values: readonly (number | null)[]) => ({ id, code, name: `Estación ${code}`, lat: -0.74, lng: -90.3, hours: series(values, NOW.getTime()) });

  function setup(hours: { santaCruz: readonly (number | null)[]; sanCristobal?: readonly (number | null)[] }) {
    const state = { hours };
    const sent: Array<{ chatId: string; message: TelegramMessage }> = [];
    const recorded = new Set<string>();
    const stations = {
      snapshot: async () => ({
        updatedAt: NOW.toISOString(),
        attribution: 'Estaciones: INAMHI',
        windowHours: 24,
        stations: [station('M0191', 64210, state.hours.santaCruz), station('M0221', 63782, state.hours.sanCristobal ?? [0, 0, 0])],
      }),
    } as unknown as WeatherStationsService;
    const archive = { getHourlyRain: async () => new Map<number, HourlyRain[]>() } as unknown as StationRainArchive;
    const rain = new GalapagosRainService(stations, archive);
    const chats = [
      { chatId: 'pais', active: true, zones: [], provinces: [], cantons: [] },
      { chatId: 'galapagos', active: true, zones: [], provinces: ['Galápagos'], cantons: [] },
      { chatId: 'manabi', active: true, zones: [], provinces: ['Manabí'], cantons: [] },
    ] as unknown as TelegramChatEntity[];
    const alerts = new GalapagosAlertsService(
      rain,
      { enabled: true, send: vi.fn(async (chatId: string, message: TelegramMessage) => void sent.push({ chatId, message })) } as unknown as TelegramClient,
      { listActive: async () => chats, save: async (chat: TelegramChatEntity) => chat } as unknown as TelegramChatStore,
      {
        wasSent: async (key: string, _channel: string, recipient: string) => recorded.has(`${key}|${recipient}`),
        record: async (delivery: { alertKey: string; recipient: string; status: string }) => {
          if (delivery.status === 'sent') recorded.add(`${delivery.alertKey}|${delivery.recipient}`);
        },
      } as unknown as DeliveryStore,
      { get: () => 'https://sati.example' } as unknown as AppConfigService,
    );
    return { state, sent, rain, alerts };
  }

  it('avisa una vez al subir de nivel, solo a quien le toca, y otra vez si llega a extrema', async () => {
    const { state, sent, alerts } = setup({ santaCruz: SANTA_CRUZ.slice(0, 22) });
    await alerts.check(NOW);
    expect(sent.map(({ chatId }) => chatId)).toEqual(['pais', 'galapagos']);
    expect(sent[0].message.text).toContain('⚠️ <b>SATI · Alarma de lluvia en Galápagos</b>');
    expect(sent[0].message.text).toContain('📍 Santa Cruz · estación M0191 (Puerto Ayora)');
    expect(sent[0].message.text).toContain('<b>118,5 mm en las últimas 24 horas</b> (umbral de alarma: 100 mm)');
    expect(sent[0].message.text).toContain('🗺️ Mapa: https://sati.example');

    // Sigue en alarma: no repite.
    await alerts.check(NOW);
    expect(sent).toHaveLength(2);

    // Una hora después la intensidad pasa a extrema: nuevo aviso.
    state.hours = { santaCruz: SANTA_CRUZ.slice(0, 23) };
    await alerts.check(NOW);
    expect(sent).toHaveLength(4);
    expect(sent[2].message.text).toContain('🚨 <b>SATI · Alarma extrema de lluvia en Galápagos</b>');
    expect(sent[2].message.text).toContain('86,4 mm en 3 horas');
  });

  it('con lluvia corriente o con datos viejos no avisa', async () => {
    const calm = setup({ santaCruz: [0, 1.3, 11.3, 0.7, 8.0] });
    await calm.alerts.check(NOW);
    expect(calm.sent).toHaveLength(0);
    // La misma lluvia de alarma, pero la revisión ocurre cinco horas después del último dato.
    const stale = setup({ santaCruz: SANTA_CRUZ.slice(0, 22) });
    await stale.alerts.check(new Date(NOW.getTime() + 5 * HOUR_MS));
    expect(stale.sent).toHaveLength(0);
  });

  it('la consulta entrega las dos estaciones, sus curvas y los bordes', async () => {
    const { rain } = setup({ santaCruz: SANTA_CRUZ.slice(0, 22), sanCristobal: [5, 0, 2.5] });
    const snapshot = await rain.snapshot(NOW);
    expect(snapshot.stations.map(({ code, island, level }) => [code, island, level])).toEqual([
      ['M0191', 'Santa Cruz', 'alarm'],
      ['M0221', 'San Cristóbal', 'normal'],
    ]);
    expect(snapshot.stations[1].hours.map(({ accumulatedMm }) => accumulatedMm)).toEqual([5, 5, 7.5]);
    expect(snapshot.references.map(({ key, totalMm, maxByDurationMm }) => [key, totalMm, maxByDurationMm.length])).toEqual([['upper', 203.6, 24], ['lower', 160.7, 24]]);
    expect(snapshot.stations[1].maxByDurationMm).toEqual([5, 5, 7.5]);
    expect(snapshot.thresholds).toMatchObject({ alarm24hMm: 100, alarm24hLoadedMm: 50, extreme3hMm: 70, extreme6hMm: 110 });
  });

  it('el mensaje dice la lluvia previa cuando la hay', () => {
    const text = galapagosAlertMessage({
      code: 'M0191', island: 'Santa Cruz', place: 'Puerto Ayora', cantonCode: '2003', name: 'Charles Darwin 1', lat: 0, lng: 0, hours: [], maxByDurationMm: [],
      ...readRain(series([14.6, 8.5, 2.0, 3.0, 4.9, 2.0, 11.0, 5.0], Date.parse('2026-11-02T20:00:00Z')), series([120, 80, 50.9], Date.parse('2026-11-01T20:00:00Z'))),
    }).text;
    expect(text).toContain('Lluvia previa: 250,9 mm en los tres días anteriores (suelo cargado: el umbral baja a la mitad).');
    expect(text).toContain('(umbral de alarma: 50 mm)');
    expect(text).toContain('Medido hasta: lun, 2 nov, 14:00 (hora de Galápagos)');
  });
});
