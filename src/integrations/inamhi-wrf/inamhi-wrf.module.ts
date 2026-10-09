import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';
import { RainForecastSource } from '../../modules/rain-forecast/rain-forecast-source.js';
import { InamhiCatalogRainForecastSource } from './inamhi-catalog-rain-forecast.source.js';
import { WrfLayersProvider } from './wrf-layers.provider.js';
import { WrfRainForecastSource } from './wrf-rain-forecast.source.js';

/**
 * Integración con el modelo WRF del INAMHI: capas WMS y lluvia en grilla para el
 * pronóstico día por día. Por defecto, la lluvia diaria del GeoServer que usa el
 * visor oficial del INAMHI (RAIN_FORECAST_SOURCE=geoglows); con
 * RAIN_FORECAST_SOURCE=inamhi, la suma de pasos de 3 h del catálogo del INAMHI.
 */
@Global()
@Module({
  providers: [
    WrfLayersProvider,
    InamhiCatalogRainForecastSource,
    WrfRainForecastSource,
    {
      provide: RainForecastSource,
      inject: [AppConfigService, InamhiCatalogRainForecastSource, WrfRainForecastSource],
      useFactory: (config: AppConfigService, inamhi: InamhiCatalogRainForecastSource, geoglows: WrfRainForecastSource) =>
        config.get('RAIN_FORECAST_SOURCE') === 'inamhi' ? inamhi : geoglows,
    },
  ],
  exports: [RainForecastSource],
})
export class InamhiWrfModule {}
