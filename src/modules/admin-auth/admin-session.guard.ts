import {
  createParamDecorator,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminAuthService, type AdminAuth } from './admin-auth.service.js';

type AdminRequest = Request & { admin?: AdminAuth };

/**
 * Exige una sesión de administrador: cabecera `Authorization: Bearer <token>`
 * con el token que entregó POST /admin/auth/login. Deja la cuenta y la sesión
 * en la request (ver @CurrentAdmin).
 */
@Injectable()
export class AdminSessionGuard implements CanActivate {
  constructor(private readonly auth: AdminAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const [scheme, token] = (request.header('authorization') ?? '').split(' ');
    const auth = scheme === 'Bearer' && token ? await this.auth.authenticate(token.trim()) : null;
    if (!auth) throw new UnauthorizedException('Sesión no válida o vencida: vuelve a iniciar sesión');
    request.admin = auth;
    return true;
  }
}

/** Cuenta y sesión de quien hace la petición. Solo en rutas con AdminSessionGuard. */
export const CurrentAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AdminAuth => context.switchToHttp().getRequest<AdminRequest>().admin!,
);
