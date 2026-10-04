import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { EventFiltersQuery, ListEventsQuery } from './dto/list-events.query.js';
import { HazardEventPageResponse, HazardEventResponse } from './dto/hazard-event.response.js';
import { EventsService, type EventFilters } from './events.service.js';

const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

@ApiTags('Eventos')
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista eventos (inundaciones, deslizamientos, …) con filtros' })
  @ApiOkResponse({ type: HazardEventPageResponse })
  async list(@Query() query: ListEventsQuery): Promise<HazardEventPageResponse> {
    const { items, total } = await this.events.list(toFilters(query), { limit: query.limit, offset: query.offset });
    return {
      data: items.map(HazardEventResponse.from),
      meta: { total, limit: query.limit, offset: query.offset },
    };
  }

  @Get('summary')
  @ApiOperation({ summary: 'Totales por severidad, tipo y provincia, e impacto acumulado' })
  summary(@Query() query: EventFiltersQuery) {
    return this.events.summary(toFilters(query));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de un evento' })
  @ApiOkResponse({ type: HazardEventResponse })
  async findOne(@Param('id', new ParseUUIDPipe()) id: string): Promise<HazardEventResponse> {
    return HazardEventResponse.from(await this.events.findById(id));
  }
}

function toFilters(query: EventFiltersQuery): EventFilters {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - DEFAULT_WINDOW_MS);
  return {
    from,
    to,
    province: query.province,
    hazardTypes: query.hazardType,
    severities: query.severity,
    status: query.status,
    bbox: query.bbox?.split(',').map(Number) as EventFilters['bbox'],
  };
}
