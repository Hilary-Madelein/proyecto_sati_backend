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
import { REFERENCE_EVENTS, TWO_DAY_LIMITS, accumulate, maxByDuration, readRain, twoDayStart, type GalapagosLevel } from './galapagos-rain.js';
import { GalapagosRainService } from './galapagos-rain.service.js';
import { GalapagosSeaService } from './galapagos-sea.service.js';
import { readSea, scenarioOf, type SeaReading } from './galapagos-sea.js';

const HOUR_MS = 60 * 60 * 1000;

/** Serie horaria que termina en `end`, con la lluvia dada (la última, la más reciente). */
const series = (values: readonly (number | null)[], end: number): HourlyRain[] =>
  values.map((mm, index) => ({ time: new Date(end - (values.length - 1 - index) * HOUR_MS).toISOString(), mm }));

/** Lluvia medida en Santa Cruz (M0191) del 30/10 03:00 al 31/10 04:00, hora del registro. */
const SANTA_CRUZ = [2.0, 0.0, 0.1, 1.4, 5.7, 3.0, 1.1, 0.8, 1.0, 0.6, 0.0, 0.8, 0.4, 0.0, 24.0, 20.6, 1.5, 0.4, 5.2, 0.3, 24.7, 24.9, 36.8, 34.9, 13.8, 1.6];
/** Lluvia medida en San Cristóbal (M0221) el 12/11, de las 02:00 a las 19:00 de Galápagos. */
const SAN_CRISTOBAL = [7.9, 1.8, 7.7, 5.3, 20.3, 7.6, 10.7, 12.7, 42.1, 7.8, 2.4, 0.9, 1.9, 1.6, 3.7, 0.1, 2.4, 0.0];
/** Lluvia medida en Santa Cruz el 12/11 (el límite inferior), de las 06:00 a las 19:00 del registro. */
const LOWER_LIMIT_DAY = [1.3, 11.3, 0.7, 0.0, 0.0, 8.0, 3.2, 0.8, 0.0, 0.0, 0.0, 1.5, 1.8, 0.0];

/** Nivel hora a hora, como lo vería la alarma: en cada hora, las últimas 24 con dato. */
function replay(values: readonly number[]): GalapagosLevel[] {
  const start = Date.parse('2026-10-30T08:00:00Z');
  return values.map((_, index) => readRain(series(values.slice(Math.max(0, index - 23), index + 1), start + index * HOUR_MS)).level);
}

describe('lectura de la lluvia de una estación de Galápagos', () => {
  it('suma hasta la última hora con dato', () => {
    const reading = readRain(series([0, 1.3, 11.3, 0.7, 0, 0, 8.0, 3.2, 0.8, null], Date.parse('2026-11-12T18:00:00Z')));
    expect(reading).toMatchObject({ lastTime: '2026-11-12T17:00:00.000Z', hoursWithData: 9, mm1h: 0.8, mm3h: 12, mm5h: 12, mm6h: 12.7, mm24h: 25.3, level: 'normal', reason: null });
  });

  it('el límite inferior (Santa Cruz, 12 de noviembre) no dispara la alarma: 20 mm en 5 horas', () => {
    expect(replay(LOWER_LIMIT_DAY).every((level) => level === 'normal')).toBe(true);
  });

  it('Santa Cruz, 30 de octubre: alarma con la primera tanda de la tarde y extrema de madrugada, antes del pico', () => {
    const levels = replay(SANTA_CRUZ);
    expect(levels.slice(0, 14).every((level) => level === 'normal')).toBe(true);
    // Con los 24 mm de las 17:00 del registro lleva 25,2 mm en 5 horas: alarma, nueve horas antes del desborde.
    expect(levels.slice(14, 22).every((level) => level === 'alarm')).toBe(true);
    // Con la hora de la 01:00 lleva 86,4 mm en 3 horas: extrema, cuando aún faltaban 48,7 mm por caer.
    expect(levels[22]).toBe('extreme');
    expect(readRain(series(SANTA_CRUZ.slice(0, 15), 0)).reason).toBe('25,2 mm en 5 horas');
    expect(readRain(series(SANTA_CRUZ.slice(0, 23), 0)).reason).toBe('86,4 mm en 3 horas (en el desborde del 30 de octubre fueron 96,6)');
  });

  it('San Cristóbal, 12 de noviembre: alarma con la hora de los 20 mm, sin llegar a extrema', () => {
    const levels = replay(SAN_CRISTOBAL);
    expect(levels.indexOf('alarm')).toBe(4);
    expect(levels).not.toContain('extreme');
  });

  it('dos tandas de unos 15 mm separadas por una pausa también son alarma', () => {
    // Llovió 16 mm, paró cinco horas y vuelve a llover parecido: en 5 horas no llega a 25 mm.
    const again = readRain(series([16, 0, 0, 0, 0, 0, 15.5], 0));
    expect(again).toMatchObject({ mm5h: 15.5, level: 'alarm', reason: 'dos tandas de lluvia con una pausa entre ellas: 16 mm y 15,5 mm' });
    // Si la segunda es menor, o si la primera fue hace más de 12 horas, no.
    expect(readRain(series([16, 0, 0, 0, 0, 0, 9], 0)).level).toBe('normal');
    expect(readRain(series([16, ...Array<number>(12).fill(0), 15.5], 0)).level).toBe('normal');
    // Una tanda de varias horas cuenta entera.
    expect(readRain(series([8, 8, 0, 0, 0, 0, 0, 0, 7, 8], 0))).toMatchObject({ level: 'alarm', reason: 'dos tandas de lluvia con una pausa entre ellas: 16 mm y 15 mm' });
  });

  it('sin datos queda en normal', () => {
    expect(readRain([])).toMatchObject({ lastTime: null, hoursWithData: 0, mm24h: 0, level: 'normal' });
  });

  it('cada estación tiene sus dos límites de dos días, sacados de su propio registro', () => {
    const totals = (code: string) => TWO_DAY_LIMITS[code].map(({ key, hourlyMm }) => [key, hourlyMm.length, accumulate(hourlyMm).at(-1)]);
    // Santa Cruz: el desborde del 30-31 de octubre y los chubascos del 11-12 de noviembre.
    expect(totals('M0191')).toEqual([['upper', 48, 229], ['lower', 48, 30.3]]);
    // San Cristóbal: la vía inundada del 11-12 de noviembre y las lloviznas del 9-10.
    expect(totals('M0221')).toEqual([['upper', 48, 189.4], ['lower', 48, 23.8]]);
    expect(accumulate([1.5, null, 2])).toEqual([1.5, 1.5, 3.5]);
  });

  it('la gráfica de dos días empieza a las 00:00 de ayer, según el día del registro (hora del continente)', () => {
    // 13/11 a las 15:00 del continente: empieza el 12/11 a las 00:00 del continente.
    expect(new Date(twoDayStart(Date.parse('2026-11-13T20:00:00Z'))).toISOString()).toBe('2026-11-12T05:00:00.000Z');
    // 13/11 a las 23:30 del continente (ya es 14 en UTC): sigue empezando el 12.
    expect(new Date(twoDayStart(Date.parse('2026-11-14T04:30:00Z'))).toISOString()).toBe('2026-11-12T05:00:00.000Z');
  });

  it('la lluvia máxima según la duración coincide con las cifras de cada episodio', () => {
    expect(maxByDuration([1, 5, null, 4, 2])).toEqual([5, 6, 9, 11, 12]);
    const [upper, lower] = REFERENCE_EVENTS.map(({ hourlyMm }) => maxByDuration(hourlyMm));
    expect([upper[0], upper[2], upper[5], upper[11], upper[23]]).toEqual([36.8, 96.6, 136.7, 188.7, 203.6]);
    expect([lower[0], lower[2], lower[5], lower[11], lower[23]]).toEqual([42.1, 65.5, 101.2, 127.2, 160.7]);
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
  // 31/10 a la 01:00 del registro (06:00 UTC).
  const NOW = new Date('2026-10-31T06:00:00Z');
  const station = (code: string, id: number, values: readonly (number | null)[], end: number) => ({ id, code, name: `Estación ${code}`, lat: -0.74, lng: -90.3, hours: series(values, end) });

  function setup(hours: { santaCruz: readonly (number | null)[]; sanCristobal?: readonly (number | null)[] }, archived: HourlyRain[] = []) {
    /** `end`: la hora del último dato de las estaciones. */
    const state: { hours: typeof hours; sea: SeaReading | null; end: number } = { hours, sea: null, end: NOW.getTime() };
    const sent: Array<{ chatId: string; message: TelegramMessage }> = [];
    const recorded = new Set<string>();
    const stations = {
      snapshot: async () => ({
        updatedAt: NOW.toISOString(),
        attribution: 'Estaciones: INAMHI',
        windowHours: 24,
        stations: [station('M0191', 64210, state.hours.santaCruz, state.end), station('M0221', 63782, state.hours.sanCristobal ?? [0, 0, 0], state.end)],
      }),
    } as unknown as WeatherStationsService;
    const archive = { getHourlyRain: async () => new Map<number, HourlyRain[]>([[64210, archived]]) } as unknown as StationRainArchive;
    const rain = new GalapagosRainService(stations, archive, { current: () => state.sea } as unknown as GalapagosSeaService);
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
    const { state, sent, alerts } = setup({ santaCruz: SANTA_CRUZ.slice(0, 15) });
    await alerts.check(NOW);
    expect(sent.map(({ chatId }) => chatId)).toEqual(['pais', 'galapagos']);
    expect(sent[0].message.text).toContain('⚠️ <b>SATI · Alarma de lluvia en Galápagos</b>');
    expect(sent[0].message.text).toContain('📍 Santa Cruz · estación M0191 (Puerto Ayora)');
    expect(sent[0].message.text).toContain('🌧️ <b>25,2 mm en 5 horas.</b>');
    expect(sent[0].message.text).toContain('Última hora: 24 mm · 5 horas: 25,2 mm');
    expect(sent[0].message.text).toContain('🗺️ Mapa: https://sati.example');

    // Sigue lloviendo y sigue en alarma: no repite.
    state.hours = { santaCruz: SANTA_CRUZ.slice(0, 20) };
    state.end += HOUR_MS;
    await alerts.check(new Date(state.end));
    expect(sent).toHaveLength(2);

    // De madrugada la intensidad pasa a extrema: nuevo aviso.
    state.hours = { santaCruz: SANTA_CRUZ.slice(0, 23) };
    state.end += HOUR_MS;
    await alerts.check(new Date(state.end));
    expect(sent).toHaveLength(4);
    expect(sent[2].message.text).toContain('🚨 <b>SATI · Alarma extrema de lluvia en Galápagos</b>');
    expect(sent[2].message.text).toContain('86,4 mm en 3 horas');
  });

  it('con la lluvia del límite inferior o con datos viejos no avisa', async () => {
    const calm = setup({ santaCruz: LOWER_LIMIT_DAY });
    await calm.alerts.check(NOW);
    expect(calm.sent).toHaveLength(0);
    // La misma lluvia de alarma, pero la revisión ocurre cinco horas después del último dato.
    const stale = setup({ santaCruz: SANTA_CRUZ.slice(0, 15) });
    await stale.alerts.check(new Date(NOW.getTime() + 5 * HOUR_MS));
    expect(stale.sent).toHaveLength(0);
  });

  it('la consulta entrega "aquí estamos" desde las 00:00 de ayer, uniendo el archivo con lo reciente, y los dos límites', async () => {
    // Lo reciente: 24 horas hasta ahora (31/10 a la 01:00 del registro). El archivo: las horas anteriores del 30/10.
    const recent = SANTA_CRUZ.slice(0, 23); // termina a la 01:00 del 31/10
    const archived = series([0, 0], NOW.getTime() - recent.length * HOUR_MS); // 01:00 y 02:00 del 30/10
    const { rain } = setup({ santaCruz: recent, sanCristobal: [5, 0, 2.5] }, archived);
    const snapshot = await rain.snapshot(NOW);
    expect(snapshot.twoDaysFrom).toBe('2026-10-30T05:00:00.000Z');
    const [santaCruz, sanCristobal] = snapshot.stations;
    expect([santaCruz.code, santaCruz.level, sanCristobal.code, sanCristobal.level]).toEqual(['M0191', 'extreme', 'M0221', 'normal']);
    // 25 horas desde las 00:00 del 30/10; el acumulado coincide con el límite superior a esa misma hora.
    expect(santaCruz.twoDays).toHaveLength(25);
    expect(santaCruz.twoDays.at(-1)).toEqual({ hour: 25, time: '2026-10-31T06:00:00.000Z', accumulatedMm: 155.3 });
    expect(santaCruz.limits.map(({ key, totalMm, accumulatedMm }) => [key, totalMm, accumulatedMm.length, accumulatedMm[24]])).toEqual([
      ['upper', 229, 48, 155.3],
      ['lower', 30.3, 48, 1.7],
    ]);
    expect(sanCristobal.limits.map(({ key, label, totalMm }) => [key, label, totalMm])).toEqual([
      ['upper', 'Límite superior: 11-12 nov, vía inundada', 189.4],
      ['lower', 'Límite inferior: 9-10 nov', 23.8],
    ]);
    // Los límites de Santa Cruz siguen también en la raíz de la respuesta.
    expect(snapshot.limits).toEqual(santaCruz.limits);
    expect(snapshot.thresholds).toEqual({ alarm5hMm: 25, alarmBurstMm: 15, extreme3hMm: 70, extreme6hMm: 110 });
    expect(snapshot.references.map(({ key, maxByDurationMm }) => [key, maxByDurationMm.length])).toEqual([['upper', 24], ['lower', 24]]);
  });

  it('el mensaje es corto y trae las dos referencias', () => {
    const hours = series(SANTA_CRUZ.slice(0, 15), Date.parse('2026-10-30T22:00:00Z'));
    const text = galapagosAlertMessage({
      code: 'M0191', island: 'Santa Cruz', place: 'Puerto Ayora', cantonCode: '2003', name: 'Charles Darwin 1', lat: 0, lng: 0, maxByDurationMm: [],
      twoDays: [{ hour: 17, time: '2026-10-30T22:00:00.000Z', accumulatedMm: 41.1 }],
      limits: [
        { key: 'upper', label: 'Límite superior: 30-31 oct, desborde', totalMm: 229, accumulatedMm: [] },
        { key: 'lower', label: 'Límite inferior: 11-12 nov', totalMm: 30.3, accumulatedMm: [] },
      ],
      ...readRain(hours),
      sea: { time: '2026-10-30T22:00:00.000Z', levelM: -0.2, high: false, place: 'Santa Cruz' },
      scenario: 'alert',
    }).text;
    expect(text).toContain('Hasta: vie, 30 oct, 16:00 (hora de Galápagos)');
    expect(text).toContain('Última hora: 24 mm · 5 horas: 25,2 mm · desde ayer: 41,1 mm');
    expect(text).toContain('En dos días, sus referencias: 30,3 mm (límite inferior: 11-12 nov) y 229 mm (límite superior: 30-31 oct, desborde).');
    expect(text).toContain('🌊 Mar bajo: −0,20 m respecto de su nivel medio (mareógrafo de Santa Cruz).');
    expect(text.split('\n').length).toBeLessThanOrEqual(8);
  });

  it('con lluvia de alarma, si el mar sube a alto pasa a emergencia y avisa de nuevo', async () => {
    const { state, sent, alerts, rain } = setup({ santaCruz: SANTA_CRUZ.slice(0, 15) });
    state.sea = { time: NOW.toISOString(), levelM: 0.1, high: false, place: 'Santa Cruz' };
    await alerts.check(NOW);
    expect(sent).toHaveLength(2);
    expect(sent[0].message.text).toContain('⚠️ <b>SATI · Alarma de lluvia en Galápagos</b>');
    expect(sent[0].message.text).toContain('🌊 Mar bajo: +0,10 m');

    state.sea = { time: NOW.toISOString(), levelM: 0.62, high: true, place: 'Santa Cruz' };
    expect((await rain.snapshot(NOW)).stations.map(({ scenario }) => scenario)).toEqual(['emergency', 'precaution']);
    // Con el mismo dato de la estación no se vuelve a decidir: espera al de la hora siguiente.
    await alerts.check(new Date(NOW.getTime() + 20 * 60_000));
    expect(sent).toHaveLength(2);
    state.end += HOUR_MS;
    await alerts.check(new Date(state.end));
    expect(sent).toHaveLength(4);
    expect(sent[2].message.text).toContain('🚨 <b>SATI · Emergencia en Galápagos: lluvia con el mar alto</b>');
    expect(sent[2].message.text).toContain('🌊 Mar alto: +0,62 m');
    // Baja la marea y vuelve a subir el mismo día: no repite.
    state.sea = { time: NOW.toISOString(), levelM: 0.1, high: false, place: 'Santa Cruz' };
    state.end += HOUR_MS;
    await alerts.check(new Date(state.end));
    state.sea = { time: NOW.toISOString(), levelM: 0.7, high: true, place: 'Santa Cruz' };
    state.end += HOUR_MS;
    await alerts.check(new Date(state.end));
    expect(sent).toHaveLength(4);
  });

  it('el mar alto sin lluvia es precaución y no se avisa', async () => {
    const { state, sent, alerts, rain } = setup({ santaCruz: LOWER_LIMIT_DAY });
    state.sea = { time: NOW.toISOString(), levelM: 0.8, high: true, place: 'Santa Cruz' };
    await alerts.check(NOW);
    expect(sent).toHaveLength(0);
    const snapshot = await rain.snapshot(NOW);
    expect(snapshot.stations[0].scenario).toBe('precaution');
    expect(snapshot.sea).toEqual(state.sea);
    expect(snapshot.highSeaM).toBe(0.5);
  });
});

describe('matriz lluvia × mar de Galápagos', () => {
  const NOW = Date.parse('2026-11-14T12:00:00Z');
  /** Una marea de 12 h 25 min y 0,7 m de amplitud sobre una referencia de 2 m, una lectura por minuto durante tres días. */
  const tide = (end: number) =>
    Array.from({ length: 3 * 24 * 60 }, (_, index) => {
      const time = end - (3 * 24 * 60 - 1 - index) * 60_000;
      return { time, level: 2 + 0.7 * Math.sin((2 * Math.PI * (time - NOW)) / (745 * 60_000) + Math.PI / 2) };
    });

  it('las cuatro casillas; la lluvia extrema es emergencia con cualquier marea y sin dato del mar decide la lluvia', () => {
    expect([scenarioOf('normal', { high: false }), scenarioOf('normal', { high: true }), scenarioOf('alarm', { high: false }), scenarioOf('alarm', { high: true })]).toEqual(['normal', 'precaution', 'alert', 'emergency']);
    expect([scenarioOf('extreme', { high: false }), scenarioOf('extreme', null), scenarioOf('alarm', null), scenarioOf('normal', null)]).toEqual(['emergency', 'emergency', 'alert', 'normal']);
  });

  it('mide el mar respecto de su nivel medio: alto en la pleamar, bajo seis horas después', () => {
    expect(readSea(tide(NOW), NOW)).toMatchObject({ high: true, place: 'Santa Cruz', time: new Date(NOW).toISOString() });
    expect(readSea(tide(NOW), NOW)!.levelM).toBeGreaterThan(0.6);
    const low = readSea(tide(NOW + 372 * 60_000), NOW + 372 * 60_000)!;
    expect(low.high).toBe(false);
    expect(low.levelM).toBeLessThan(-0.6);
  });

  it('ignora los saltos del sensor y no usa lecturas viejas o escasas', () => {
    const spiky = [...tide(NOW - 5 * 60_000), ...Array.from({ length: 5 }, (_, index) => ({ time: NOW - (4 - index) * 60_000, level: 9 }))];
    expect(readSea(spiky, NOW)!.levelM).toBeLessThan(1);
    expect(readSea(tide(NOW - 3 * HOUR_MS), NOW)).toBeNull();
    expect(readSea(tide(NOW).slice(-200), NOW)).toBeNull();
  });

  it('el servicio baja la semana día por día y después solo lo nuevo', async () => {
    const calls: Array<[string, string]> = [];
    const client = {
      enabled: true,
      readings: async (_code: string, _sensor: string, from: Date, to: Date) => {
        calls.push([from.toISOString(), to.toISOString()]);
        return tide(NOW).filter(({ time }) => time >= from.getTime() && time <= to.getTime());
      },
    };
    const service = new GalapagosSeaService(client as never);
    expect(service.current(new Date(NOW))).toBeNull();
    await service.refresh(NOW);
    expect(calls).toHaveLength(7);
    expect(service.current(new Date(NOW))).toMatchObject({ high: true });
    await service.refresh(NOW + 10 * 60_000);
    expect(calls).toHaveLength(8);
    expect(calls[7][0]).toBe(new Date(NOW - 10 * 60_000).toISOString());
  });
});
