import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfigService } from '../../config/app-config.service.js';
import { splitText, TelegramError, type TelegramClient, type TelegramMessage } from '../../integrations/telegram/telegram.client.js';
import { InMemoryFlashFloodIssueStore, InMemoryTelegramChatStore } from '../../storage/memory/in-memory-flood-alert.stores.js';
import { InMemoryDeliveryStore } from '../../storage/memory/in-memory-notification.stores.js';
import type { JsonFilePersistence } from '../../storage/memory/json-file-persistence.js';
import type { FloodHubService } from '../flood-hub/flood-hub.service.js';
import type { FlashFloodArea, FlashFloodLikelihood } from '../flood-hub/flood-hub-source.js';
import type { CantonAnalysisService } from '../canton-analysis/canton-analysis.service.js';
import type { WeatherStationsService } from '../weather-stations/weather-stations.service.js';
import { CantonCatalog } from './canton-catalog.js';
import { TelegramChatEntity } from './entities/telegram-chat.entity.js';
import { NATIONAL, type ChatScope } from './flood-alert-scope.js';
import { improvedMessage, worsenedMessage } from './flood-alert-messages.js';
import { FloodAlertsService } from './flood-alerts.service.js';
import { TelegramBotService } from './telegram-bot.service.js';

vi.mock('../canton-analysis/parishes.js', () => ({
  loadParishes: async () => [
    { code: '091', name: 'A', cantonCode: '0901', canton: 'Guayaquil', province: 'Guayas', kind: 'cabecera', lat: -2.5, lng: -79.5 },
    { code: '070', name: 'B', cantonCode: '0701', canton: 'Machala', province: 'El Oro', kind: 'cabecera', lat: -2.6, lng: -79.6 },
    { code: '110', name: 'C', cantonCode: '1101', canton: 'Loja', province: 'Loja', kind: 'cabecera', lat: -4, lng: -79.2 },
  ],
}));

const NOON = new Date('2026-11-01T20:00:00Z');
const INVITE = 'codigo-de-prueba';
const MAP_URL = 'https://mapa.ejemplo.ec';

const zone = (likelihood: FlashFloodLikelihood, issuedAt: string, validUntil: string): FlashFloodArea => ({
  id: `${likelihood}-${issuedAt}`,
  likelihood,
  issuedAt,
  validUntil,
  countries: ['EC'],
  geometry: {
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [-80, -3],
          [-79, -3],
          [-79, -2],
          [-80, -2],
          [-80, -3],
        ],
      ],
    ],
  },
});

describe('alertas de crecidas por Telegram', () => {
  let sent: { chatId: string; message: TelegramMessage }[];
  let snapshot: { isStale: boolean; flashFloods: FlashFloodArea[] | null };
  let chats: InMemoryTelegramChatStore;
  let deliveries: InMemoryDeliveryStore;
  let send: ReturnType<typeof vi.fn>;
  let editMessage: ReturnType<typeof vi.fn>;
  let analysisSnapshot: ReturnType<typeof vi.fn>;
  let service: FloodAlertsService;
  let bot: TelegramBotService;

  const addChat = (chatId: string, scope: ChatScope = NATIONAL) =>
    chats.save(Object.assign(new TelegramChatEntity(), scope, { chatId, firstName: null, username: null, active: true }));

  beforeEach(() => {
    sent = [];
    snapshot = { isStale: false, flashFloods: [zone('likely', '2026-11-01T12:00:00Z', '2026-11-02T12:00:00Z')] };
    chats = new InMemoryTelegramChatStore();
    deliveries = new InMemoryDeliveryStore();
    send = vi.fn(async (chatId: string, message: TelegramMessage) => void sent.push({ chatId, message }));
    editMessage = vi.fn(async () => undefined);
    const telegram = { enabled: true, send, editMessage, answerCallback: vi.fn(async () => undefined) } as unknown as TelegramClient;
    const settings: Record<string, string> = { TELEGRAM_INVITE_CODE: INVITE, APP_PUBLIC_URL: MAP_URL };
    const config = { get: (key: string) => settings[key] } as unknown as AppConfigService;
    const floodHub = { snapshot: async () => snapshot } as unknown as FloodHubService;
    const catalog = new CantonCatalog();
    analysisSnapshot = vi.fn(async () => ({
      parishes: [
        { code: '090101', cantonCode: '0901', point: [-2.5, -79.5], forecast: { mm24h: 40 } },
        { code: '090102', cantonCode: '0901', point: [-2.6, -79.5], forecast: { mm24h: 95.4 } },
        // Fuera de la zona de Google: no debe contar.
        { code: '090103', cantonCode: '0901', point: [-1, -79.5], forecast: { mm24h: 300 } },
        { code: '070101', cantonCode: '0701', point: [-2.6, -79.6], forecast: { mm24h: null } },
      ],
    }));
    const analysis = { snapshot: analysisSnapshot } as unknown as CantonAnalysisService;
    const stations = {
      snapshot: async () => ({
        stations: [
          { name: 'Cerca', lat: -2.52, lng: -79.5, totalMm: 3.25, hoursWithData: 12 },
          { name: 'Pocas horas', lat: -2.5, lng: -79.5, totalMm: 50, hoursWithData: 2 },
          { name: 'Lejos', lat: -2.6, lng: -78.5, totalMm: 80, hoursWithData: 12 },
        ],
      }),
    } as unknown as WeatherStationsService;
    service = new FloodAlertsService(floodHub, telegram, chats, new InMemoryFlashFloodIssueStore(), deliveries, catalog, analysis, stations, config);
    bot = new TelegramBotService(telegram, chats, service, catalog, config);
  });

  it('avisa una vez por emisión aunque se revise muchas veces', async () => {
    await addChat('1');
    await service.check(NOON);
    await service.check(NOON);
    expect(sent).toHaveLength(1);
    expect(sent[0].message.text).toContain('Guayaquil');
  });

  it('cada alerta lleva al mapa con botón y con la dirección en el texto', async () => {
    await addChat('1');
    await service.check(NOON);
    expect(sent[0].message.link).toEqual({ label: 'Ver en el mapa', url: MAP_URL });
    expect(sent[0].message.text).toContain(`Mapa: ${MAP_URL}`);
  });

  it('cada persona recibe solo lo que eligió, y nada si no le toca', async () => {
    await addChat('pais');
    await addChat('guayas', { provinces: ['Guayas'], cantons: [] });
    await addChat('machala', { provinces: [], cantons: [{ code: '0701', name: 'Machala', province: 'El Oro' }] });
    await addChat('loja', { provinces: ['Loja'], cantons: [] });
    await service.check(NOON);

    const textOf = (chatId: string) => sent.find((item) => item.chatId === chatId)?.message.text;
    expect(textOf('pais')).toContain('Guayaquil');
    expect(textOf('pais')).toContain('Machala');
    expect(textOf('guayas')).toContain('crecida repentina en Guayas');
    expect(textOf('guayas')).toContain('Guayaquil');
    expect(textOf('guayas')).not.toContain('Machala');
    expect(textOf('machala')).toContain('crecida repentina en Machala');
    expect(textOf('machala')).not.toContain('cantón');
    expect(textOf('machala')).toContain('zonas de unos 20 km');
    expect(textOf('loja')).toBeUndefined();
  });

  it('con varios lugares elegidos, lista por provincia solo los suyos', async () => {
    await addChat('dos', { provinces: ['Guayas', 'Loja'], cantons: [] });
    await service.check(NOON);
    expect(sent[0].message.text).toContain('<b>Guayas · 1</b>\nGuayaquil');
    expect(sent[0].message.text).not.toContain('Machala');
  });

  it('una mejora también respeta lo elegido', async () => {
    await addChat('guayas', { provinces: ['Guayas'], cantons: [] });
    await addChat('loja', { provinces: ['Loja'], cantons: [] });
    await service.check(NOON);
    snapshot.flashFloods = [];
    await service.check(new Date('2026-11-02T13:00:00Z'));
    expect(sent.map(({ chatId }) => chatId)).toEqual(['guayas', 'guayas']);
    expect(sent[1].message.text).toContain('Ya no aparecen');
  });

  it('muestra la lluvia pronosticada más alta dentro de la zona y lo medido cerca', async () => {
    await addChat('1');
    await service.check(NOON);
    const { text } = sent[0].message;
    expect(text).toContain('Guayaquil · 95 mm · 🌧️ 3 mm');
    expect(text).not.toContain('300');
    expect(text).toContain('Machala');
    expect(text).toContain('mm: lluvia pronosticada para 24 h');
    expect(text).toContain('🌧️: lluvia ya medida');
  });

  it('con un solo cantón dice de dónde sale cada cifra', async () => {
    await addChat('1', { provinces: [], cantons: [{ code: '0901', name: 'Guayaquil', province: 'Guayas' }] });
    await service.check(NOON);
    const { text } = sent[0].message;
    expect(text).toContain('Pronóstico 24 h: hasta 95 mm (WRF-INAMHI)');
    expect(text).toContain('Ya medido en 12 h: 3 mm (Cerca, a 2 km)');
  });

  it('si no hay datos de lluvia, la alerta sale igual, sin cifras', async () => {
    await addChat('1');
    analysisSnapshot.mockRejectedValue(new Error('WRF caído'));
    await service.check(NOON);
    expect(sent).toHaveLength(1);
    expect(sent[0].message.text).toContain('Guayaquil');
    expect(sent[0].message.text).not.toContain('mm');
    expect(sent[0].message.text).not.toContain('lluvia pronosticada');
  });

  it('la lluvia no se guarda en el estado de los avisos', async () => {
    await addChat('1');
    await service.check(NOON);
    sent.length = 0;
    snapshot.flashFloods = [zone('likely', '2026-11-01T18:00:00Z', '2026-11-02T18:00:00Z')];
    await service.check(NOON);
    expect(sent).toEqual([]);
  });

  it('Probable llega en silencio y Muy probable con sonido', async () => {
    await addChat('1');
    await service.check(NOON);
    snapshot.flashFloods = [zone('highly_likely', '2026-11-01T18:00:00Z', '2026-11-02T18:00:00Z')];
    await service.check(NOON);
    expect(sent.map(({ message }) => message.silent)).toEqual([true, false]);
  });

  it('una emisión nueva con los mismos cantones no envía nada', async () => {
    await addChat('1');
    await service.check(NOON);
    snapshot.flashFloods = [zone('likely', '2026-11-01T18:00:00Z', '2026-11-02T18:00:00Z')];
    await service.check(NOON);
    expect(sent).toHaveLength(1);
  });

  it('no toma decisiones con datos viejos', async () => {
    await addChat('1');
    snapshot.isStale = true;
    await service.check(NOON);
    snapshot = { isStale: false, flashFloods: null };
    await service.check(NOON);
    expect(sent).toEqual([]);
  });

  it('una lista vacía no cierra avisos antes de que venza su vigencia, y al vencer sí', async () => {
    await addChat('1');
    await service.check(NOON);
    snapshot.flashFloods = [];
    await service.check(NOON);
    expect(sent).toHaveLength(1);
    await service.check(new Date('2026-11-02T13:00:00Z'));
    expect(sent).toHaveLength(2);
    expect(sent[1].message.text).toContain('Ya no aparecen');
    expect(sent[1].message.silent).toBe(true);
  });

  it('desactiva el chat que bloqueó el bot y sigue con los demás', async () => {
    await addChat('1');
    await addChat('2');
    send.mockRejectedValueOnce(new TelegramError('Forbidden: bot was blocked by the user', 403));
    await service.check(NOON);
    expect((await chats.find('1'))?.active).toBe(false);
    expect(sent.map(({ chatId }) => chatId)).toEqual(['2']);
    expect((await deliveries.list({ limit: 10, offset: 0, status: 'failed' })).total).toBe(1);
  });

  describe('bot', () => {
    const text = (value: string, id = 7) => ({
      update_id: 1,
      message: { text: value, chat: { id, type: 'private' }, from: { first_name: 'Ana', username: 'ana' } },
    });

    const tap = (data: string, id = 7) => ({
      update_id: 9,
      callback_query: { id: 'q', data, message: { message_id: 50, chat: { id, type: 'private' } } },
    });
    /** Botón de la última pantalla con esa etiqueta. */
    const button = (label: string) => {
      const rows = (editMessage.mock.calls.at(-1)?.[3] ?? sent.at(-1)?.message.buttons) as { label: string; data: string }[][];
      return rows.flat().find((item) => item.label === label)!.data;
    };

    it('registra a quien abre el enlace y le pregunta qué alertas quiere, por defecto todo el país', async () => {
      await service.check(NOON);
      await bot.handle(text(`/start ${INVITE}`));
      expect(await chats.find('7')).toMatchObject({ active: true, firstName: 'Ana', provinces: [], cantons: [] });
      expect(sent).toHaveLength(2);
      expect(sent[1].message.text).toContain('¿Qué alertas quieres recibir?');
      expect(sent[1].message.buttons?.flat().map(({ label }) => label)).toEqual(['Todo el país', 'Provincias', 'Cantones']);
    });

    it('al marcar una provincia queda guardada y rige para las alertas futuras', async () => {
      await bot.handle(text(`/start ${INVITE}`));
      await bot.handle(tap(button('Provincias')));
      await bot.handle(tap(button('Guayas')));
      await bot.handle(tap(button('Listo')));
      expect(await chats.find('7')).toMatchObject({ provinces: ['Guayas'], cantons: [] });
      expect(editMessage.mock.calls.at(-1)?.[2]).toContain('Recibirás alertas de: Guayas.');

      sent.length = 0;
      await service.check(NOON);
      expect(sent).toHaveLength(1);
      expect(sent[0].message.text).toContain('Guayaquil');
      expect(sent[0].message.text).not.toContain('Machala');
    });

    it('al marcar un cantón pasa por su provincia', async () => {
      await bot.handle(text(`/start ${INVITE}`));
      await bot.handle(tap(button('Cantones')));
      await bot.handle(tap(button('El Oro')));
      await bot.handle(tap(button('Machala')));
      expect(await chats.find('7')).toMatchObject({ provinces: [], cantons: [{ code: '0701', name: 'Machala', province: 'El Oro' }] });
    });

    it('permite marcar varias provincias y cantones juntos, y recibe solo eso', async () => {
      await bot.handle(text(`/start ${INVITE}`));
      await bot.handle(tap(button('Provincias')));
      await bot.handle(tap(button('Loja')));
      await bot.handle(tap(button('Guayas')));
      expect(await chats.find('7')).toMatchObject({ provinces: ['Loja', 'Guayas'] });
      await bot.handle(tap(button('← Volver')));
      await bot.handle(tap(button('Cantones')));
      await bot.handle(tap(button('El Oro')));
      await bot.handle(tap(button('Machala')));
      await bot.handle(tap(button('Listo')));
      expect(editMessage.mock.calls.at(-1)?.[2]).toContain('Loja, Guayas, Machala (cantón de El Oro)');

      sent.length = 0;
      await service.check(NOON);
      expect(sent).toHaveLength(1);
      expect(sent[0].message.text).toContain('Guayaquil');
      expect(sent[0].message.text).toContain('Machala');
    });

    it('marca lo elegido en los botones, y un segundo toque lo desmarca', async () => {
      await bot.handle(text(`/start ${INVITE}`));
      await bot.handle(tap(button('Provincias')));
      await bot.handle(tap(button('Guayas')));
      expect(button('✅ Guayas')).toBeTruthy();
      await bot.handle(tap(button('✅ Guayas')));
      expect(await chats.find('7')).toMatchObject({ provinces: [] });
    });

    it('Todo el país borra lo marcado', async () => {
      await addChat('7', { provinces: ['Guayas'], cantons: [{ code: '0701', name: 'Machala', province: 'El Oro' }] });
      await bot.handle(tap('scope:national'));
      expect(await chats.find('7')).toMatchObject({ provinces: [], cantons: [] });
    });

    it('/estado muestra solo lo elegido', async () => {
      await service.check(NOON);
      await addChat('7', { provinces: ['Guayas'], cantons: [] });
      await bot.handle(text('/estado'));
      expect(sent.at(-1)?.message.text).toContain('Guayaquil');
      expect(sent.at(-1)?.message.text).not.toContain('Machala');
    });

    it('si en su provincia no hay riesgo, lo dice', async () => {
      await service.check(NOON);
      await addChat('7', { provinces: ['Loja'], cantons: [] });
      await bot.handle(text('/estado'));
      expect(sent.at(-1)?.message.text).toContain('no marca riesgo de crecida repentina en Loja');
    });

    it('lo elegido se conserva tras /parar y volver', async () => {
      await addChat('7', { provinces: ['Loja'], cantons: [] });
      await bot.handle(text('/parar'));
      await bot.handle(text('/start'));
      expect(await chats.find('7')).toMatchObject({ active: true, provinces: ['Loja'] });
      expect(sent.at(-2)?.message.text).toContain('alertas de: Loja');
    });

    it('los botones no sirven a quien no está registrado', async () => {
      await bot.handle(tap('pv:0'));
      expect(await chats.find('7')).toBeNull();
    });

    it('lo elegido sobrevive a un reinicio, y quien se registró antes queda en todo el país', async () => {
      const files = new Map<string, unknown>();
      const persistence = {
        load: (name: string) => files.get(name) ?? null,
        save: (name: string, snapshot: () => unknown) => files.set(name, JSON.parse(JSON.stringify(snapshot()))),
      } as unknown as JsonFilePersistence;
      const before = new InMemoryTelegramChatStore(persistence);
      await before.save(Object.assign(new TelegramChatEntity(), { chatId: '7', active: true, provinces: ['Guayas'], cantons: [] }));
      expect(await new InMemoryTelegramChatStore(persistence).find('7')).toMatchObject({ provinces: ['Guayas'] });

      files.set('telegram-chats', [{ chatId: '8', active: true, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' }]);
      expect(await new InMemoryTelegramChatStore(persistence).find('8')).toMatchObject({ provinces: [], cantons: [] });
    });

    it('rechaza el /start sin el código o con uno equivocado', async () => {
      await bot.handle(text('/start'));
      await bot.handle(text('/start otro-codigo'));
      expect(await chats.find('7')).toBeNull();
      expect(sent[0].message.text).toContain('enlace de invitación');
    });

    it('/estado no le muestra datos a quien no entró', async () => {
      await service.check(NOON);
      await bot.handle(text('/estado'));
      expect(sent[0].message.text).not.toContain('Guayaquil');
    });

    it('/parar corta las alertas y se puede volver', async () => {
      await bot.handle(text(`/start ${INVITE}`));
      await bot.handle(text('/parar'));
      expect((await chats.find('7'))?.active).toBe(false);
      expect(await chats.listActive()).toEqual([]);
      await bot.handle(text('/start'));
      expect((await chats.find('7'))?.active).toBe(true);
    });

    it('al bloquear el bot deja de recibir', async () => {
      await bot.handle(text(`/start ${INVITE}`));
      await bot.handle({ update_id: 2, my_chat_member: { chat: { id: 7, type: 'private' }, new_chat_member: { status: 'kicked' } } });
      expect((await chats.find('7'))?.active).toBe(false);
    });

    it('ignora los grupos', async () => {
      await bot.handle({ update_id: 3, message: { text: `/start ${INVITE}`, chat: { id: -5, type: 'group' } } });
      expect(await chats.find('-5')).toBeNull();
    });
  });
});

describe('mensajes', () => {
  const canton = (name: string, province: string, likelihood: FlashFloodLikelihood) => ({ code: name, canton: name, province, likelihood });

  it('agrupa por nivel y provincia, con todos los cantones', () => {
    const text = worsenedMessage(
      [canton('Durán', 'Guayas', 'highly_likely'), canton('Baba', 'Los Ríos', 'likely'), canton('Daule', 'Guayas', 'highly_likely')],
      new Date('2026-11-02T19:33:35Z'),
    );
    expect(text).toContain('📍 3 cantones en 2 provincias');
    expect(text).toContain('MUY PROBABLE</b> · 2 cantones');
    expect(text).toContain('<blockquote><b>Guayas · 2</b>\nDaule\nDurán</blockquote>');
    expect(text).toContain('PROBABLE</b> · 1 cantón');
    expect(text).toContain('14:33');
  });

  const withRain = (name: string, forecastMm: number) => ({ ...canton(name, 'Guayas', 'likely'), rain: { forecastMm, measured: null } });

  it('ordena por lluvia, sin decimales, y escapa las cifras menores que 1', () => {
    const text = worsenedMessage([withRain('Nobol', 10.4), withRain('Milagro', 120), withRain('Daule', 0.5)], new Date());
    expect(text).toContain('Milagro · 120 mm\nNobol · 10 mm\nDaule · &lt;1 mm');
  });

  it('pliega los Probables cuando son muchos, y nunca los Muy probables', () => {
    const many = (likelihood: FlashFloodLikelihood) => Array.from({ length: 9 }, (_, index) => canton(`C${index}`, 'Guayas', likelihood));
    expect(worsenedMessage(many('likely'), new Date())).toContain('<blockquote expandable>');
    expect(worsenedMessage(many('highly_likely'), new Date())).not.toContain('expandable');
    expect(worsenedMessage([canton('Daule', 'Guayas', 'likely')], new Date())).not.toContain('expandable');
  });

  it('un mensaje enorme se parte sin dejar etiquetas abiertas', () => {
    const provinces = Array.from({ length: 24 }, (_, index) => `Provincia ${index}`);
    const cantons = provinces.flatMap((province) => Array.from({ length: 20 }, (_, index) => canton(`Cantón largo número ${index} de ${province}`, province, 'likely')));
    const parts = splitText(worsenedMessage(cantons, new Date()));
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(4096);
      expect(part.match(/<blockquote/g)?.length ?? 0).toBe(part.match(/<\/blockquote>/g)?.length ?? 0);
    }
  });

  it('escapa lo que no es de confianza', () => {
    expect(worsenedMessage([canton('A<b>', 'P&Q', 'likely')], new Date())).toContain('A&lt;b&gt;');
  });

  it('una mejora nunca dice que no hay peligro', () => {
    const text = improvedMessage({ lowered: [canton('Machala', 'El Oro', 'likely')], left: [canton('Arenillas', 'El Oro', 'likely')] });
    expect(text).toContain('Bajó a Probable');
    expect(text).toContain('<b>El Oro:</b> Machala');
    expect(text).toContain('Ya no aparecen en el pronóstico');
    expect(text).toContain('puede continuar');
    expect(text.toLowerCase()).not.toContain('sin peligro');
  });

  it('parte los textos largos entre bloques', () => {
    const parts = splitText(['a'.repeat(6), 'b\nb'.repeat(2), 'c'.repeat(6)].join('\n\n'), 14);
    expect(parts).toEqual([`${'a'.repeat(6)}\n\nb\nbb\nb`, 'c'.repeat(6)]);
  });
});
