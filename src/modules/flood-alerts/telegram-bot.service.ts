import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';
import { TelegramClient, TelegramError, type TelegramButton, type TelegramUpdate } from '../../integrations/telegram/telegram.client.js';
import { CantonCatalog, type CatalogProvince } from './canton-catalog.js';
import { TelegramChatEntity } from './entities/telegram-chat.entity.js';
import { EXPLORE, explorerView, isExplorerData, parseTarget } from './flood-alert-explorer.js';
import { NATIONAL, scopeLabel } from './flood-alert-scope.js';
import { PLANNING_ZONES } from './planning-zones.js';
import { TelegramChatStore } from './flood-alert-stores.js';
import { FloodAlertsService } from './flood-alerts.service.js';

/** Pausa tras un error de red, y tras un 409 (otro proceso lee con el mismo token). */
const ERROR_PAUSE_MS = 10_000;
const CONFLICT_PAUSE_MS = 60_000;

const ALERTS_COMMAND = 'Configurar alertas: todo el país, zonas, provincias o cantones';
const HELP = `Comandos:\n/alertas: ${ALERTS_COMMAND.charAt(0).toLowerCase()}${ALERTS_COMMAND.slice(1)}\n/estado: zonas de riesgo vigentes\n/parar: dejar de recibir alertas`;
const CHOOSE = '¿Qué alertas quieres recibir? Puedes marcar varias zonas, provincias y cantones.';
const NOT_REGISTERED = 'No estás registrado. Usa el enlace de invitación que recibiste.';

/** Datos de los botones: Telegram los devuelve al tocarlos (máximo 64 bytes). */
const MENU = 'menu';
const DONE = 'done';
const NATIONAL_SCOPE = 'scope:national';
const PICK_ZONES = 'scope:zones';
const PICK_PROVINCES = 'scope:provinces';
const PICK_CANTONS = 'scope:cantons';
const ZONE = 'zn:';
const PROVINCE = 'pv:';
const CANTONS_OF = 'cp:';
const CANTON = 'ct:';

type ChatMessage = NonNullable<TelegramUpdate['message']>;
type CallbackQuery = NonNullable<TelegramUpdate['callback_query']>;

const SCOPE_MENU: TelegramButton[][] = [
  [{ label: 'Todo el país', data: NATIONAL_SCOPE }],
  [
    { label: 'Zonas', data: PICK_ZONES },
    { label: 'Provincias', data: PICK_PROVINCES },
    { label: 'Cantones', data: PICK_CANTONS },
  ],
];

/** Qué provincias forman cada zona: va en el texto, porque no cabe en los botones. */
const ZONES_TEXT = [
  '<b>Marca una o más zonas de planificación y toca Listo:</b>',
  '',
  ...PLANNING_ZONES.map(({ number, description }) => `<b>Zona ${number}:</b> ${description}`),
].join('\n');

const DONE_BUTTON: TelegramButton = { label: 'Listo', data: DONE };

const marked = (selected: boolean, label: string) => (selected ? `✅ ${label}` : label);

/** Botones en dos columnas. */
function twoColumns(buttons: TelegramButton[]): TelegramButton[][] {
  const rows: TelegramButton[][] = [];
  for (let index = 0; index < buttons.length; index += 2) rows.push(buttons.slice(index, index + 2));
  return rows;
}

/** Quita lo que ya estaba y agrega lo que no: cada toque marca o desmarca. */
const toggled = <T>(list: readonly T[], isSame: (item: T) => boolean, item: T): T[] =>
  list.some(isSame) ? list.filter((other) => !isSame(other)) : [...list, item];

/**
 * Atiende el bot: quien abre el enlace de invitación queda registrado con su chat
 * id y marca con botones qué alertas recibir; lo elegido queda guardado. Lee con
 * long polling, que no necesita una dirección pública y funciona igual en local
 * que en el servidor, siempre que un solo proceso use el token.
 */
@Injectable()
export class TelegramBotService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TelegramBotService.name);
  private readonly stop = new AbortController();
  private offset = 0;

  constructor(
    private readonly telegram: TelegramClient,
    private readonly chats: TelegramChatStore,
    private readonly alerts: FloodAlertsService,
    private readonly catalog: CantonCatalog,
    private readonly config: AppConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.telegram.enabled) return;
    void this.telegram
      .setCommands([
        { command: 'alertas', description: ALERTS_COMMAND },
        { command: 'estado', description: 'Zonas de riesgo vigentes' },
        { command: 'parar', description: 'Dejar de recibir alertas' },
      ])
      .catch((error: Error) => this.logger.warn(`No se pudieron publicar los comandos: ${error.message}`));
    void this.poll();
  }

  onApplicationShutdown(): void {
    this.stop.abort();
  }

  private async poll(): Promise<void> {
    while (!this.stop.signal.aborted) {
      try {
        for (const update of await this.telegram.getUpdates(this.offset, this.stop.signal)) {
          // Se confirma aunque falle: un mensaje que siempre falla no debe trabar a los demás.
          this.offset = update.update_id + 1;
          await this.handle(update).catch((error: Error) => this.logger.error(`No se pudo atender un mensaje: ${error.message}`));
        }
      } catch (error) {
        if (this.stop.signal.aborted) return;
        const conflict = error instanceof TelegramError && error.code === 409;
        if (conflict) this.logger.warn('Otro proceso está leyendo el bot con el mismo token');
        else this.logger.warn(`No se pudo leer Telegram: ${(error as Error).message}`);
        await new Promise((resolve) => setTimeout(resolve, conflict ? CONFLICT_PAUSE_MS : ERROR_PAUSE_MS));
      }
    }
  }

  /** Atiende una novedad. Solo chats privados. */
  async handle(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) return this.choose(update.callback_query);

    const membership = update.my_chat_member;
    if (membership?.chat.type === 'private' && ['kicked', 'left'].includes(membership.new_chat_member.status)) {
      await this.setActive(String(membership.chat.id), false);
      return;
    }

    const message = update.message;
    if (message?.chat.type !== 'private' || !message.text) return;
    const chatId = String(message.chat.id);
    const [command, argument] = message.text.trim().split(/\s+/);
    switch (command) {
      case '/start':
        return this.start(chatId, argument, message);
      case '/parar':
        await this.setActive(chatId, false);
        return this.telegram.send(chatId, { text: 'Listo, no recibirás más alertas. Para volver, abre de nuevo el enlace.' });
      case '/estado':
        return this.status(chatId);
      case '/alertas':
        return this.menu(chatId);
      default:
        return this.telegram.send(chatId, { text: HELP });
    }
  }

  private async start(chatId: string, code: string | undefined, message: ChatMessage): Promise<void> {
    // Quien ya entró con el enlace puede volver sin él, por ejemplo tras desbloquear el bot.
    const known = await this.chats.find(chatId);
    if (!known && code !== this.config.get('TELEGRAM_INVITE_CODE')) {
      return this.telegram.send(chatId, { text: 'Este bot es solo para quienes participan en la prueba. Usa el enlace de invitación que recibiste.' });
    }
    const chat = await this.chats.save(
      Object.assign(known ?? Object.assign(new TelegramChatEntity(), NATIONAL), {
        chatId,
        firstName: message.from?.first_name?.slice(0, 120) ?? null,
        username: message.from?.username?.slice(0, 64) ?? null,
        active: true,
      }),
    );
    this.logger.log(`Chat ${known ? 'reactivado' : 'registrado'}: ${chatId}`);

    // Quien vuelve conserva lo que eligió.
    if (known) {
      await this.telegram.send(chatId, { text: `Volviste a la prueba de alertas de SATI. Sigues recibiendo alertas de: ${scopeLabel(chat)}.\n\n${HELP}` });
      return this.telegram.send(chatId, await this.alerts.currentStatus(chat));
    }
    await this.telegram.send(chatId, {
      text: `Quedaste registrado en la prueba de alertas de SATI: te avisaremos cuando Google marque riesgo de crecida repentina.\n\n${HELP}`,
    });
    await this.telegram.send(chatId, { text: CHOOSE, buttons: SCOPE_MENU });
  }

  private async status(chatId: string): Promise<void> {
    const chat = await this.chats.find(chatId);
    if (!chat?.active) return this.telegram.send(chatId, { text: NOT_REGISTERED });
    await this.telegram.send(chatId, await this.alerts.currentStatus(chat));
  }

  private async menu(chatId: string): Promise<void> {
    const chat = await this.chats.find(chatId);
    if (!chat?.active) return this.telegram.send(chatId, { text: NOT_REGISTERED });
    await this.telegram.send(chatId, { text: `Ahora recibes alertas de: ${scopeLabel(chat)}.\n\n${CHOOSE}`, buttons: SCOPE_MENU });
  }

  /** Un botón de los menús: navega por ellos o marca y desmarca lugares, que se guardan al instante. */
  private async choose(query: CallbackQuery): Promise<void> {
    await this.telegram.answerCallback(query.id);
    if (query.message?.chat.type !== 'private' || !query.data) return;
    const chatId = String(query.message.chat.id);
    const messageId = query.message.message_id;
    const chat = await this.chats.find(chatId);
    if (!chat?.active) return this.telegram.editMessage(chatId, messageId, NOT_REGISTERED);

    const data = query.data;
    const provinces = await this.catalog.provinces();
    const provinceAt = (prefix: string) => provinces[Number(data.slice(prefix.length))];

    if (isExplorerData(data)) {
      const target = parseTarget(data, provinces);
      if (!target) return;
      const view = explorerView(await this.alerts.explorerData(chat), target);
      // Desde la alerta se abre un mensaje aparte; dentro del detalle, se reemplaza en el mismo lugar.
      if (data === EXPLORE) return this.telegram.send(chatId, { text: view.text, buttons: view.buttons, silent: true });
      return this.telegram.editMessage(chatId, messageId, view.text, view.buttons);
    }
    if (data === MENU) return this.telegram.editMessage(chatId, messageId, `Ahora recibes alertas de: ${scopeLabel(chat)}.\n\n${CHOOSE}`, SCOPE_MENU);
    if (data === DONE) return this.finish(chat, messageId);
    if (data === NATIONAL_SCOPE) {
      await this.chats.save(Object.assign(chat, NATIONAL));
      return this.finish(chat, messageId);
    }
    if (data === PICK_ZONES) return this.showZones(chat, messageId);
    if (data === PICK_PROVINCES) return this.showProvinces(chat, messageId, provinces);
    if (data === PICK_CANTONS) return this.showCantonProvinces(chat, messageId, provinces);

    if (data.startsWith(ZONE)) {
      const number = Number(data.slice(ZONE.length));
      if (!PLANNING_ZONES.some((zone) => zone.number === number)) return;
      chat.zones = toggled(chat.zones, (zone) => zone === number, number);
      await this.chats.save(chat);
      return this.showZones(chat, messageId);
    }
    if (data.startsWith(PROVINCE)) {
      const province = provinceAt(PROVINCE);
      if (!province) return;
      chat.provinces = toggled(chat.provinces, (name) => name === province.name, province.name);
      await this.chats.save(chat);
      return this.showProvinces(chat, messageId, provinces);
    }
    if (data.startsWith(CANTONS_OF)) {
      const province = provinceAt(CANTONS_OF);
      if (province) await this.showCantons(chat, messageId, province);
      return;
    }
    if (data.startsWith(CANTON)) {
      const code = data.slice(CANTON.length);
      const province = provinces.find((item) => item.cantons.some((canton) => canton.code === code));
      const canton = province?.cantons.find((item) => item.code === code);
      if (!province || !canton) return;
      chat.cantons = toggled(chat.cantons, (item) => item.code === code, { code, name: canton.name, province: province.name });
      await this.chats.save(chat);
      return this.showCantons(chat, messageId, province);
    }
  }

  private showZones(chat: TelegramChatEntity, messageId: number): Promise<void> {
    const buttons = PLANNING_ZONES.map(({ number }) => ({ label: marked(chat.zones.includes(number), `Zona ${number}`), data: `${ZONE}${number}` }));
    const rows: TelegramButton[][] = [];
    for (let index = 0; index < buttons.length; index += 3) rows.push(buttons.slice(index, index + 3));
    return this.telegram.editMessage(chat.chatId, messageId, ZONES_TEXT, [...rows, [{ label: '← Volver', data: MENU }, DONE_BUTTON]]);
  }

  private showProvinces(chat: TelegramChatEntity, messageId: number, provinces: CatalogProvince[]): Promise<void> {
    const buttons = provinces.map(({ name }, index) => ({ label: marked(chat.provinces.includes(name), name), data: `${PROVINCE}${index}` }));
    return this.telegram.editMessage(chat.chatId, messageId, 'Marca una o más provincias y toca Listo:', [
      ...twoColumns(buttons),
      [{ label: '← Volver', data: MENU }, DONE_BUTTON],
    ]);
  }

  private showCantonProvinces(chat: TelegramChatEntity, messageId: number, provinces: CatalogProvince[]): Promise<void> {
    const buttons = provinces.map(({ name }, index) => {
      const count = chat.cantons.filter((canton) => canton.province === name).length;
      return { label: marked(count > 0, count > 0 ? `${name} (${count})` : name), data: `${CANTONS_OF}${index}` };
    });
    return this.telegram.editMessage(chat.chatId, messageId, 'Elige una provincia para ver sus cantones:', [
      ...twoColumns(buttons),
      [{ label: '← Volver', data: MENU }, DONE_BUTTON],
    ]);
  }

  private showCantons(chat: TelegramChatEntity, messageId: number, province: CatalogProvince): Promise<void> {
    const buttons = province.cantons.map(({ code, name }) => ({
      label: marked(
        chat.cantons.some((canton) => canton.code === code),
        name,
      ),
      data: `${CANTON}${code}`,
    }));
    return this.telegram.editMessage(chat.chatId, messageId, `Marca uno o más cantones de ${province.name}:`, [
      ...twoColumns(buttons),
      [{ label: '← Provincias', data: PICK_CANTONS }, DONE_BUTTON],
    ]);
  }

  /** Confirma lo elegido, que rige para todas las alertas futuras, y muestra lo vigente allí. */
  private async finish(chat: TelegramChatEntity, messageId: number): Promise<void> {
    this.logger.log(`Chat ${chat.chatId}: alertas de ${scopeLabel(chat)}`);
    await this.telegram.editMessage(chat.chatId, messageId, `✅ Guardado. Recibirás alertas de: ${scopeLabel(chat)}.\nPara cambiarlo, usa /alertas.`);
    await this.telegram.send(chat.chatId, await this.alerts.currentStatus(chat));
  }

  private async setActive(chatId: string, active: boolean): Promise<void> {
    const chat = await this.chats.find(chatId);
    if (chat) await this.chats.save(Object.assign(chat, { active }));
  }
}
