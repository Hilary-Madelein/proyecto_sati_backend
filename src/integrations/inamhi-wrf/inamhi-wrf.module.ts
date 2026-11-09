import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';
import { RainForecastSource } from '../../modules/rain-forecast/rain-forecast-source.js';
import { AutoRainForecastSource } from './auto-rain-forecast.source.js';
import { InamhiCatalogRainForecastSource } from './inamhi-catalog-rain-forecast.source.js';
import { WrfLayersProvider } from './wrf-layers.provider.js';
import { WrfRainForecastSource } from './wrf-rain-forecast.source.js';

/**
 * Integración con el modelo WRF del INAMHI: capas WMS y lluvia en grilla para el
 * pronóstico. Por defecto (RAIN_FORECAST_SOURCE=auto), el servicio con la corrida
 * más reciente entre el visor oficial (GeoGLOWS) y el catálogo del INAMHI, y el
 * otro si uno falla; con "geoglows" o "inamhi", solo ese.
 */
@Global()
@Module({
  providers: [
    WrfLayersProvider,
    InamhiCatalogRainForecastSource,
    WrfRainForecastSource,
    AutoRainForecastSource,
    {
      provide: RainForecastSource,
      inject: [AppConfigService, InamhiCatalogRainForecastSource, WrfRainForecastSource, AutoRainForecastSource],
      useFactory: (
        config: AppConfigService,
        inamhi: InamhiCatalogRainForecastSource,
        geoglows: WrfRainForecastSource,
        auto: AutoRainForecastSource,
      ) => {
        const choice = config.get('RAIN_FORECAST_SOURCE');
        return choice === 'inamhi' ? inamhi : choice === 'geoglows' ? geoglows : auto;
      },
    },
  ],
  exports: [RainForecastSource],
})
export class InamhiWrfModule {}
