import { timingSafeEqual } from 'node:crypto';
import { ForbiddenException, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AppConfigService } from '../../config/app-config.service.js';

export const ADMIN_TOKEN_HEADER = 'x-admin-token';

/**
 * Protege acciones para automatizaciones (p. ej. un cron que lanza una
 * sincronización) con un token fijo (ADMIN_TOKEN) en la cabecera
 * `x-admin-token`. Si ADMIN_TOKEN no está definido, las rechaza todas.
 * Las personas no lo usan: el panel entra con cuentas (ver AdminSessionGuard).
 */
@Injectable()
export class AdminTokenGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get('ADMIN_TOKEN');
    if (!expected) throw new ForbiddenException('Las acciones administrativas están deshabilitadas (falta ADMIN_TOKEN)');

    const received = context.switchToHttp().getRequest<Request>().header(ADMIN_TOKEN_HEADER) ?? '';
    const [a, b] = [Buffer.from(received), Buffer.from(expected)];
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException('Token de administración inválido');
    return true;
  }
}
