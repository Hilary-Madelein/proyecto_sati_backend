import { Module } from '@nestjs/common';
import { AdminAuthController, AdminUsersController } from './admin-auth.controller.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminSessionGuard } from './admin-session.guard.js';
import { AdminUsersService } from './admin-users.service.js';

/**
 * Cuentas de administración con correo y contraseña, y sus sesiones. Los
 * almacenes (AdminUserStore, AdminSessionStore) los aporta el almacenamiento.
 * Otros módulos importan este para proteger sus rutas con AdminSessionGuard.
 */
@Module({
  controllers: [AdminAuthController, AdminUsersController],
  providers: [AdminAuthService, AdminUsersService, AdminSessionGuard],
  exports: [AdminAuthService, AdminUsersService, AdminSessionGuard],
})
export class AdminAuthModule {}
