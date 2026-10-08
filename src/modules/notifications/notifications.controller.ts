import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AdminSessionGuard } from '../admin-auth/admin-session.guard.js';
import { ECUADOR_PROVINCES } from '../../common/geo/ecuador-provinces.js';
import { CreateSubscriberDto, TestEmailDto, UpdateSubscriberDto } from './dto/subscriber.dto.js';
import { DELIVERY_STATUSES, type DeliveryStatus } from './entities/notification-delivery.entity.js';
import { MailSender } from './mail-sender.js';
import { DeliveryStore } from './notification-stores.js';
import { NotificationsService } from './notifications.service.js';
import { SubscribersService } from './subscribers.service.js';

const MAX_PAGE = 200;
const SUMMARY_DAYS = 7;

/**
 * Administración de notificaciones: suscriptores, historial de envíos y correo
 * de prueba. Todo requiere una sesión de administrador (POST /admin/auth/login).
 */
@ApiTags('Notificaciones (admin)')
@ApiBearerAuth()
@UseGuards(AdminSessionGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly subscribers: SubscribersService,
    private readonly notifications: NotificationsService,
    private readonly deliveries: DeliveryStore,
    private readonly mail: MailSender,
  ) {}

  @Get('summary')
  @ApiOperation({ summary: `Resumen para el panel: suscriptores, envíos de los últimos ${SUMMARY_DAYS} días y estado del correo` })
  async summary() {
    const since = new Date(Date.now() - SUMMARY_DAYS * 24 * 3_600_000);
    const [subscribers, deliveries] = await Promise.all([this.subscribers.list(), this.deliveries.countSince(since)]);
    return {
      subscribers: { total: subscribers.length, active: subscribers.filter((subscriber) => subscriber.active).length },
      deliveries: { days: SUMMARY_DAYS, ...deliveries },
      /** false = no hay SMTP: los correos solo se escriben en el log del backend. */
      emailConfigured: this.mail.delivers,
    };
  }

  @Get('provinces')
  @ApiOperation({ summary: 'Provincias válidas para las suscripciones' })
  provinces() {
    return ECUADOR_PROVINCES;
  }

  @Get('subscribers')
  @ApiOperation({ summary: 'Lista de suscriptores' })
  listSubscribers() {
    return this.subscribers.list();
  }

  @Get('subscribers/:id')
  @ApiOperation({ summary: 'Un suscriptor' })
  getSubscriber(@Param('id', ParseUUIDPipe) id: string) {
    return this.subscribers.get(id);
  }

  @Post('subscribers')
  @ApiOperation({ summary: 'Registrar un suscriptor (provincias vacías = todo el país)' })
  createSubscriber(@Body() dto: CreateSubscriberDto) {
    return this.subscribers.create(dto);
  }

  @Patch('subscribers/:id')
  @ApiOperation({ summary: 'Editar un suscriptor (p. ej. active=false para pausar sus alertas)' })
  updateSubscriber(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSubscriberDto) {
    return this.subscribers.update(id, dto);
  }

  @Delete('subscribers/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Eliminar un suscriptor (su historial de envíos se conserva)' })
  async deleteSubscriber(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.subscribers.remove(id);
  }

  @Get('deliveries')
  @ApiOperation({ summary: 'Historial de envíos, del más reciente al más antiguo' })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiQuery({ name: 'offset', required: false, example: 0 })
  @ApiQuery({ name: 'status', required: false, enum: DELIVERY_STATUSES })
  listDeliveries(@Query('limit') limit = '50', @Query('offset') offset = '0', @Query('status') status?: string) {
    return this.deliveries.list({
      limit: Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), MAX_PAGE),
      offset: Math.max(Number.parseInt(offset, 10) || 0, 0),
      status: DELIVERY_STATUSES.includes(status as DeliveryStatus) ? (status as DeliveryStatus) : undefined,
    });
  }

  @Post('test')
  @HttpCode(200)
  @ApiOperation({ summary: 'Enviar un correo de prueba para verificar la configuración SMTP' })
  sendTest(@Body() dto: TestEmailDto) {
    return this.notifications.sendTest({ email: dto.email, name: dto.name ?? 'equipo de SATI.EC' });
  }
}
