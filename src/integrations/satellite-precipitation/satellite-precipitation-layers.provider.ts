import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';
import { MapLayerProvider, type MapLayerDefinition, type MapLayerProviderAdapter } from '../../modules/map-layers/map-layer.js';

const PRODUCTS = [
  {
    key: 'imerg',
    layerPrefix: 'imerg_early_run',
    name: 'IMERG',
    attribution: 'Lluvia observada: NASA GPM IMERG (Early Run) · INAMHI',
  },
  {
    key: 'persiann',
    layerPrefix: 'persiann_pdir',
    name: 'PERSIANN',
    attribution: 'Lluvia observada: CHRS PERSIANN-PDIR-Now · INAMHI',
  },
] as const;

const WINDOWS = ['24h', '48h', '72h'] as const;

/**
 * Lluvia observada por satélite, ya acumulada por el INAMHI en ventanas de
 * 24, 48 y 72 h hasta la última imagen disponible. A diferencia del WRF, no es
 * un pronóstico: es la lluvia que ya cayó.
 */
@MapLayerProvider()
@Injectable()
export class SatellitePrecipitationLayersProvider implements MapLayerProviderAdapter {
  constructor(private readonly config: AppConfigService) {}

  getLayers(): MapLayerDefinition[] {
    const serviceUrl = this.config.get('SATELLITE_PRECIPITATION_WMS_URL');
    return PRODUCTS.flatMap((product) =>
      WINDOWS.map((window) => ({
        kind: 'wms' as const,
        id: `${product.key}-${window}`,
        title: `Lluvia observada ${window} (${product.name})`,
        description: `Precipitación acumulada en las últimas ${window} estimada por satélite (${product.name}).`,
        category: 'rain' as const,
        attribution: product.attribution,
        unit: 'mm',
        serviceUrl,
        layerName: `satellite_based_precipitation:${product.layerPrefix}_${window}`,
        extraParams: [],
        // La capa se actualiza con cada imagen nueva: caché corta.
        tileCacheSeconds: 900,
      })),
    );
  }
}
