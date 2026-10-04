import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { HAZARD_TYPE_VALUES, type HazardType } from '../domain/hazard-type.js';
import type { EventStatus } from '../domain/normalized-event.js';
import { SEVERITIES, type Severity } from '../domain/severity.js';

/** "a,b" o ["a","b"] -> ["a","b"] */
const toList = ({ value }: { value: unknown }) =>
  (Array.isArray(value) ? value : String(value).split(','))
    .map((item) => String(item).trim())
    .filter(Boolean);

const NUMBER = String.raw`-?\d+(\.\d+)?`;

export class EventFiltersQuery {
  @ApiPropertyOptional({ description: 'Desde (ISO 8601). Por defecto, hace 7 días.', example: '2026-09-25' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Hasta (ISO 8601). Por defecto, ahora.' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ description: 'Provincia (sin distinguir mayúsculas).', example: 'Los Ríos' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  province?: string;

  @ApiPropertyOptional({ description: 'Tipos separados por coma.', enum: HAZARD_TYPE_VALUES, isArray: true })
  @IsOptional()
  @Transform(toList)
  @IsIn(HAZARD_TYPE_VALUES, { each: true })
  hazardType?: HazardType[];

  @ApiPropertyOptional({ description: 'Severidades separadas por coma.', enum: SEVERITIES, isArray: true })
  @IsOptional()
  @Transform(toList)
  @IsIn(SEVERITIES, { each: true })
  severity?: Severity[];

  @ApiPropertyOptional({ enum: ['open', 'closed'] })
  @IsOptional()
  @IsIn(['open', 'closed'])
  status?: EventStatus;

  @ApiPropertyOptional({ description: 'Recuadro minLng,minLat,maxLng,maxLat (WGS84).', example: '-81.1,-5.1,-75.2,1.5' })
  @IsOptional()
  @Matches(new RegExp(`^${NUMBER}(,${NUMBER}){3}$`), { message: 'bbox debe ser minLng,minLat,maxLng,maxLat' })
  bbox?: string;
}

export class ListEventsQuery extends EventFiltersQuery {
  @ApiPropertyOptional({ default: 500, maximum: 2000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2000)
  limit: number = 500;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}
