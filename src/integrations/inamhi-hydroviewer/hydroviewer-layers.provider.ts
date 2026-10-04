import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';
import { MapLayerProvider, type MapLayerDefinition, type MapLayerProviderAdapter } from '../../modules/map-layers/map-layer.js';

/** Red de ríos del Ecuador del Hydroviewer del INAMHI (GEOGLOWS / TDX-Hydro). */
@MapLayerProvider()
@Injectable()
export class HydroviewerLayersProvider implements MapLayerProviderAdapter {
  constructor(private readonly config: AppConfigService) {}

  getLayers(): MapLayerDefinition[] {
    const base = this.config.get('HYDROVIEWER_TILES_URL').replace(/\/+$/, '');
    return [
      {
        kind: 'vector',
        id: 'rivers-ecuador',
        title: 'Red de ríos (GEOGLOWS)',
        description: 'Tramos de río del modelo GEOGLOWS en Ecuador, con su orden de Strahler.',
        category: 'hydrology',
        attribution: 'Ríos: INAMHI · GEOGLOWS',
        tileUrl: `${base}/geoglows_drainage_ecuador/{z}/{x}/{y}`,
        sourceLayer: 'geoglows_drainage_ecuador',
        minZoom: 3,
        maxZoom: 16,
        // La red de ríos es estática: se puede cachear un día.
        tileCacheSeconds: 86_400,
      },
    ];
  }
}
