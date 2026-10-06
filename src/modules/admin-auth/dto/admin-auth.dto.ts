import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../password-hasher.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const normalizeEmail = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

const NEW_PASSWORD_MESSAGE = `La contraseña debe tener entre ${PASSWORD_MIN_LENGTH} y ${PASSWORD_MAX_LENGTH} caracteres`;

export class LoginDto {
  @ApiProperty({ example: 'ana.perez@ejemplo.ec' })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Escribe un correo válido' })
  @MaxLength(254)
  email: string;

  @ApiProperty({ format: 'password' })
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;
}

export class ChangePasswordDto {
  @ApiProperty({ format: 'password' })
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword: string;

  @ApiProperty({ format: 'password', minLength: PASSWORD_MIN_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: NEW_PASSWORD_MESSAGE })
  @MaxLength(PASSWORD_MAX_LENGTH, { message: NEW_PASSWORD_MESSAGE })
  newPassword: string;
}

export class CreateAdminUserDto {
  @ApiProperty({ example: 'Ana Pérez', maxLength: 120 })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: 'ana.perez@ejemplo.ec' })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Escribe un correo válido' })
  @MaxLength(254)
  email: string;

  @ApiProperty({ format: 'password', description: 'Contraseña temporal: la persona deberá cambiarla al entrar.' })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: NEW_PASSWORD_MESSAGE })
  @MaxLength(PASSWORD_MAX_LENGTH, { message: NEW_PASSWORD_MESSAGE })
  password: string;
}

export class UpdateAdminUserDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ description: 'false = la cuenta no puede entrar y se cierran sus sesiones.' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ResetPasswordDto {
  @ApiProperty({ format: 'password', description: 'Contraseña temporal: la persona deberá cambiarla al entrar.' })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: NEW_PASSWORD_MESSAGE })
  @MaxLength(PASSWORD_MAX_LENGTH, { message: NEW_PASSWORD_MESSAGE })
  password: string;
}
