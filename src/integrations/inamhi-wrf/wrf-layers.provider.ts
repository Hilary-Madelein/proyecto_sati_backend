import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';
import { MapLayerProvider, type MapLayerDefinition, type MapLayerProviderAdapter } from '../../modules/map-layers/map-layer.js';

const ATTRIBUTION = 'INAMHI · Modelo WRF (servido por GeoGLOWS)';

/**
 * Capas del modelo WRF del INAMHI, publicadas en el GeoServer de GeoGLOWS.
 * El servicio es HTTP: el backend hace de proxy para evitar el bloqueo de
 * contenido mixto en un sitio HTTPS.
 */
@MapLayerProvider()
@Injectable()
export class WrfLayersProvider implements MapLayerProviderAdapter {
  constructor(private readonly config: AppConfigService) {}

  getLayers(): MapLayerDefinition[] {
    const serviceUrl = this.config.get('GEOGLOWS_WRF_WMS_URL');
    const common = {
      kind: 'wms' as const,
      category: 'rain' as const,
      attribution: ATTRIBUTION,
      unit: 'mm',
      serviceUrl,
      // DIM_INITD elige la corrida del modelo; sin ella el servidor usa la más reciente.
      extraParams: ['DIM_INITD'],
      // Las teselas solo cambian con TIME y DIM_INITD, que van en la URL.
      tileCacheSeconds: 600,
    };

    return [
      {
        ...common,
        id: 'wrf-precipitation',
        title: 'Lluvia horaria (WRF)',
        description: 'Precipitación por hora pronosticada por el modelo WRF del INAMHI.',
        layerName: 'wrf:wrf_precipitation',
      },
      {
        ...common,
        id: 'wrf-precipitation-daily',
        title: 'Lluvia diaria (WRF)',
        description: 'Precipitación acumulada por día pronosticada por el modelo WRF del INAMHI.',
        layerName: 'wrf:wrf_precipitation_daily',
      },
    ];
  }
}
