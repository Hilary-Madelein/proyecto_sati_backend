import { Controller, Get, Param, ParseIntPipe, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude } from 'class-validator';
import type { Response } from 'express';
import { forecastMembersCsv, forecastStatsCsv } from './domain/forecast-csv.js';
import { HydrologyService } from './hydrology.service.js';

class RiverAtQuery {
  @Type(() => Number)
  @IsLatitude()
  lat: number;

  @Type(() => Number)
  @IsLongitude()
  lng: number;
}

@ApiTags('Ríos (caudales)')
@Controller('rivers')
export class HydrologyController {
  constructor(private readonly hydrology: HydrologyService) {}

  @Get('alerts')
  @ApiOperation({ summary: 'Tramos de río con alerta por caudal alto, por día del pronóstico más reciente' })
  alerts() {
    return this.hydrology.getAlerts();
  }

  @Get('at')
  @ApiOperation({ summary: 'Tramo de río más cercano a un punto (y su alerta, si tiene)' })
  riverAt(@Query() query: RiverAtQuery) {
    return this.hydrology.findRiverAt(query.lat, query.lng);
  }

  @Get(':riverId/forecast')
  @ApiOperation({ summary: 'Pronóstico de caudal de un tramo de río (ensamble y alta resolución)' })
  forecast(@Param('riverId', ParseIntPipe) riverId: number) {
    return this.hydrology.getForecast(riverId);
  }

  @Get('forecast-runs')
  @ApiOperation({
    summary: 'Corridas de pronóstico disponibles: las recientes por la API de GEOGLOWS y las anteriores (desde julio de 2024) en su archivo AWS',
  })
  forecastRuns() {
    return this.hydrology.getForecastRuns();
  }

  @Get(':riverId/forecast-runs/:date')
  @ApiOperation({
    summary: 'Lo que pronosticaba una corrida pasada (AAAA-MM-DD) para un tramo: estadísticas del ensamble y alta resolución',
    description: 'Las corridas del archivo AWS tardan de 10 a 60 s la primera vez (se descarga un bloque de ~15 MB); después quedan en caché.',
  })
  @ApiQuery({ name: 'format', required: false, enum: ['json', 'csv'], description: 'csv = descarga un archivo .csv' })
  async archivedForecast(
    @Param('riverId', ParseIntPipe) riverId: number,
    @Param('date') date: string,
    @Query('format') format: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const forecast = await this.hydrology.getArchivedForecast(riverId, date);
    if (format !== 'csv') return forecast;
    sendCsv(response, `geoglows_${riverId}_${forecast.run}.csv`);
    return forecastStatsCsv(forecast);
  }

  @Get(':riverId/forecast-runs/:date/members')
  @ApiOperation({ summary: 'Los 52 miembros de una corrida pasada para un tramo (51 del ensamble + alta resolución)' })
  @ApiQuery({ name: 'format', required: false, enum: ['json', 'csv'], description: 'csv = descarga un archivo .csv' })
  async archivedMembers(
    @Param('riverId', ParseIntPipe) riverId: number,
    @Param('date') date: string,
    @Query('format') format: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const members = await this.hydrology.getArchivedMembers(riverId, date);
    if (format !== 'csv') return members;
    sendCsv(response, `geoglows_${riverId}_${members.run}_miembros.csv`);
    return forecastMembersCsv(members);
  }

  @Get(':riverId/return-periods')
  @ApiOperation({ summary: 'Caudales de los periodos de retorno de un tramo (2 a 100 años). La primera consulta tarda ~16 s' })
  returnPeriods(@Param('riverId', ParseIntPipe) riverId: number) {
    return this.hydrology.getReturnPeriods(riverId);
  }
}

/** Cabeceras para que el navegador o Insomnia lo guarde como archivo. */
function sendCsv(response: Response, filename: string): void {
  response.setHeader('Content-Type', 'text/csv; charset=utf-8');
  response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
}
