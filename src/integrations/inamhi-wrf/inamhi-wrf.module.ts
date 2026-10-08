import { Global, Module } from '@nestjs/common';
import { RainForecastSource } from '../../modules/rain-forecast/rain-forecast-source.js';
import { WrfLayersProvider } from './wrf-layers.provider.js';
import { WrfRainForecastSource } from './wrf-rain-forecast.source.js';

/** Integración con el modelo WRF del INAMHI (GeoServer de GeoGLOWS): capas WMS y lluvia en grilla (WCS). */
@Global()
@Module({
  providers: [WrfLayersProvider, { provide: RainForecastSource, useClass: WrfRainForecastSource }],
  exports: [RainForecastSource],
})
export class InamhiWrfModule {}
