import { ApiProperty } from '@nestjs/swagger';
import { HAZARD_TYPES, HAZARD_TYPE_VALUES, type HazardType } from '../domain/hazard-type.js';
import type { EventStatus } from '../domain/normalized-event.js';
import { SEVERITIES, SEVERITY_LABELS, type Severity } from '../domain/severity.js';
import type { HazardEventEntity } from '../entities/hazard-event.entity.js';

class LocationDto {
  @ApiProperty() lat: number;
  @ApiProperty() lng: number;
}

class ImpactDto {
  @ApiProperty() affected: number;
  @ApiProperty() housesAffected: number;
  @ApiProperty() evacuated: number;
  @ApiProperty() deceased: number;
}

/** Forma pública de un evento: sin el registro original ni campos internos. */
export class HazardEventResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'sngr' }) source: string;
  @ApiProperty({ nullable: true, type: String }) code: string | null;
  @ApiProperty({ enum: HAZARD_TYPE_VALUES }) hazardType: HazardType;
  @ApiProperty({ example: 'Inundación' }) hazardTypeLabel: string;
  @ApiProperty({ enum: SEVERITIES }) severity: Severity;
  @ApiProperty({ example: 'Crítico' }) severityLabel: string;
  @ApiProperty({ nullable: true, type: Number, description: 'Nivel oficial de la fuente (SNGR: 1, 2, 3…)' })
  level: number | null;
  @ApiProperty({ enum: ['open', 'closed'] }) status: EventStatus;
  @ApiProperty() title: string;
  @ApiProperty({ nullable: true, type: String }) description: string | null;
  @ApiProperty({ nullable: true, type: String }) province: string | null;
  @ApiProperty({ nullable: true, type: String }) canton: string | null;
  @ApiProperty({ nullable: true, type: String }) sector: string | null;
  @ApiProperty({ type: LocationDto }) location: LocationDto;
  @ApiProperty({ type: ImpactDto }) impact: ImpactDto;
  @ApiProperty() occurredAt: string;
  @ApiProperty({ description: 'Última vez que cambió en la fuente.' }) updatedAt: string;

  static from(entity: HazardEventEntity): HazardEventResponse {
    const [lng, lat] = entity.location.coordinates;
    return {
      id: entity.id,
      source: entity.source,
      code: entity.code,
      hazardType: entity.hazardType,
      hazardTypeLabel: HAZARD_TYPES[entity.hazardType],
      severity: entity.severity,
      severityLabel: SEVERITY_LABELS[entity.severity],
      level: entity.level,
      status: entity.status,
      title: entity.title,
      description: entity.description,
      province: entity.province,
      canton: entity.canton,
      sector: entity.sector,
      location: { lat, lng },
      impact: {
        affected: entity.affected,
        housesAffected: entity.housesAffected,
        evacuated: entity.evacuated,
        deceased: entity.deceased,
      },
      occurredAt: entity.occurredAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}

export class PageMetaDto {
  @ApiProperty() total: number;
  @ApiProperty() limit: number;
  @ApiProperty() offset: number;
}

export class HazardEventPageResponse {
  @ApiProperty({ type: [HazardEventResponse] }) data: HazardEventResponse[];
  @ApiProperty({ type: PageMetaDto }) meta: PageMetaDto;
}
