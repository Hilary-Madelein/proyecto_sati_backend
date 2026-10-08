import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ECUADOR_PROVINCES } from '../../../common/geo/ecuador-provinces.js';
import { SUBSCRIBER_MIN_SEVERITIES, type SubscriberMinSeverity } from '../entities/notification-subscriber.entity.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateSubscriberDto {
  @ApiProperty({ example: 'Ana Pérez', maxLength: 120 })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: 'ana.perez@ejemplo.ec' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'email debe ser un correo válido' })
  @MaxLength(254)
  email: string;

  @ApiPropertyOptional({
    description: 'Provincias de las que recibe alertas. Vacío u omitido = todo el país. Sin importar tildes ni mayúsculas.',
    example: ['Los Ríos', 'Guayas'],
    enum: ECUADOR_PROVINCES,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ECUADOR_PROVINCES.length)
  @IsString({ each: true })
  provinces?: string[];

  @ApiPropertyOptional({
    description: 'Severidad mínima: "high" recibe Alto y Crítico; "critical" solo Crítico.',
    enum: SUBSCRIBER_MIN_SEVERITIES,
    default: 'high',
  })
  @IsOptional()
  @IsIn(SUBSCRIBER_MIN_SEVERITIES)
  minSeverity?: SubscriberMinSeverity;

  @ApiPropertyOptional({ description: 'false = registrado pero sin recibir alertas.', default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateSubscriberDto extends PartialType(CreateSubscriberDto) {}

export class TestEmailDto {
  @ApiProperty({ example: 'ana.perez@ejemplo.ec' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'email debe ser un correo válido' })
  email: string;

  @ApiPropertyOptional({ example: 'Ana' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  name?: string;
}
