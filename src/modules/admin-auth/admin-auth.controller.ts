import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminAuthService, type AdminAuth } from './admin-auth.service.js';
import { AdminSessionGuard, CurrentAdmin } from './admin-session.guard.js';
import { AdminUsersService } from './admin-users.service.js';
import {
  ChangePasswordDto,
  CreateAdminUserDto,
  LoginDto,
  ResetPasswordDto,
  UpdateAdminUserDto,
} from './dto/admin-auth.dto.js';
import { toAdminUserView } from './entities/admin-user.entity.js';

@ApiTags('Administración: sesión')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Iniciar sesión con correo y contraseña; devuelve el token de sesión' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Get('me')
  @UseGuards(AdminSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cuenta de la sesión actual' })
  me(@CurrentAdmin() admin: AdminAuth) {
    return toAdminUserView(admin.user);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AdminSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cerrar la sesión actual' })
  async logout(@CurrentAdmin() admin: AdminAuth): Promise<void> {
    await this.auth.logout(admin);
  }

  @Post('password')
  @HttpCode(204)
  @UseGuards(AdminSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cambiar la propia contraseña (cierra las demás sesiones)' })
  async changePassword(@CurrentAdmin() admin: AdminAuth, @Body() dto: ChangePasswordDto): Promise<void> {
    await this.auth.changePassword(admin, dto.currentPassword, dto.newPassword);
  }
}

@ApiTags('Administración: cuentas')
@ApiBearerAuth()
@UseGuards(AdminSessionGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  @ApiOperation({ summary: 'Cuentas de administración' })
  list() {
    return this.users.list();
  }

  @Post()
  @ApiOperation({ summary: 'Crear una cuenta con contraseña temporal' })
  create(@Body() dto: CreateAdminUserDto) {
    return this.users.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Renombrar, activar o desactivar una cuenta' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAdminUserDto, @CurrentAdmin() admin: AdminAuth) {
    return this.users.update(id, dto, admin.user.id);
  }

  @Post(':id/password')
  @HttpCode(204)
  @ApiOperation({ summary: 'Poner una contraseña temporal a otra cuenta (cierra sus sesiones)' })
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentAdmin() admin: AdminAuth,
  ): Promise<void> {
    await this.users.resetPassword(id, dto.password, admin.user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Eliminar una cuenta' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() admin: AdminAuth): Promise<void> {
    await this.users.remove(id, admin.user.id);
  }
}
