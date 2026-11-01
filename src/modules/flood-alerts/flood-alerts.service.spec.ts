import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfigService } from '../../config/app-config.service.js';
import { splitText, TelegramError, type TelegramClient, type TelegramMessage } from '../../integrations/telegram/telegram.client.js';
import { InMemoryFlashFloodIssueStore, InMemoryTelegramChatStore } from '../../storage/memory/in-memory-flood-alert.stores.js';
import { InMemoryDeliveryStore } from '../../storage/memory/in-memory-notification.stores.js';
import type { FloodHubService } from '../flood-hub/flood-hub.service.js';
import type { FlashFloodArea, FlashFloodLikelihood } from '../flood-hub/flood-hub-source.js';
import { TelegramChatEntity } from './entities/telegram-chat.entity.js';
import { improvedMessage, worsenedMessage } from './flood-alert-messages.js';
import { FloodAlertsService } from './flood-alerts.service.js';
import { TelegramBotService } from './telegram-bot.service.js';

vi.mock('../canton-analysis/parishes.js', () => ({
  loadParishes: async () => [
    { code: '091', name: 'A', cantonCode: '0901', canton: 'Guayaquil', province: 'Guayas', kind: 'cabecera', lat: -2.5, lng: -79.5 },
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
  let service: FloodAlertsService;
  let bot: TelegramBotService;

  const addChat = (chatId: string) => chats.save(Object.assign(new TelegramChatEntity(), { chatId, firstName: null, username: null, active: true }));

  beforeEach(() => {
    sent = [];
    snapshot = { isStale: false, flashFloods: [zone('likely', '2026-11-01T12:00:00Z', '2026-11-02T12:00:00Z')] };
    chats = new InMemoryTelegramChatStore();
    deliveries = new InMemoryDeliveryStore();
    send = vi.fn(async (chatId: string, message: TelegramMessage) => void sent.push({ chatId, message }));
    const telegram = { enabled: true, send } as unknown as TelegramClient;
    const settings: Record<string, string> = { TELEGRAM_INVITE_CODE: INVITE, APP_PUBLIC_URL: MAP_URL };
    const config = { get: (key: string) => settings[key] } as unknown as AppConfigService;
    const floodHub = { snapshot: async () => snapshot } as unknown as FloodHubService;
    service = new FloodAlertsService(floodHub, telegram, chats, new InMemoryFlashFloodIssueStore(), deliveries, config);
    bot = new TelegramBotService(telegram, chats, service, config);
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

    it('registra a quien abre el enlace y le muestra lo vigente', async () => {
      await service.check(NOON);
      await bot.handle(text(`/start ${INVITE}`));
      expect(await chats.find('7')).toMatchObject({ active: true, firstName: 'Ana' });
      expect(sent).toHaveLength(2);
      expect(sent[1].message.text).toContain('Guayaquil');
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
    expect(text).toContain('Muy probable</b> · 2 cantones');
    expect(text).toContain('<b>Guayas (2):</b> Daule, Durán');
    expect(text).toContain('Probable</b> · 1 cantón');
    expect(text).toContain('14:33');
  });

  it('escapa lo que no es de confianza', () => {
    expect(worsenedMessage([canton('A<b>', 'P&Q', 'likely')], new Date())).toContain('A&lt;b&gt;');
  });

  it('una mejora nunca dice que no hay peligro', () => {
    const text = improvedMessage({ lowered: [canton('Machala', 'El Oro', 'likely')], left: [canton('Arenillas', 'El Oro', 'likely')] });
    expect(text).toContain('Bajó a Probable');
    expect(text).toContain('Ya no aparecen en el pronóstico');
    expect(text).toContain('puede continuar');
    expect(text.toLowerCase()).not.toContain('sin peligro');
  });

  it('parte los textos largos sin cortar líneas', () => {
    const parts = splitText(['a'.repeat(6), 'b'.repeat(6), 'c'.repeat(6)].join('\n'), 13);
    expect(parts).toEqual([`${'a'.repeat(6)}\n${'b'.repeat(6)}`, 'c'.repeat(6)]);
  });
});
