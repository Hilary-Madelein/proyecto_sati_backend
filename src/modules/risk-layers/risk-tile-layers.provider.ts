import { Injectable } from '@nestjs/common';
import {
  MapLayerProvider,
  type MapLayerDefinition,
  type MapLayerProviderAdapter,
} from '../map-layers/map-layer.js';

const SNGR_TILES =
  'https://tiles.arcgis.com/tiles/csQLKpeoUQumugVg/arcgis/rest/services';

/**
 * Capas de gestión del riesgo que solo se publican como teselas vectoriales
 * (VectorTileServer de ArcGIS): se sirven por el proxy de /layers/:id/tiles.
 */
@MapLayerProvider()
@Injectable()
export class RiskTileLayersProvider implements MapLayerProviderAdapter {
  getLayers(): MapLayerDefinition[] {
    return [
      {
        kind: 'vector',
        id: 'provincial-roads',
        title: 'Red vial provincial',
        description:
          'Vías a cargo de los gobiernos provinciales. Las teselas solo traen el trazado (sin nombre ni estado).',
        category: 'risk',
        attribution: 'Red vial provincial: SNGR',
        // ArcGIS ordena la tesela como {z}/{y}/{x}. Teselas de 512 px hasta el nivel 12.
        tileUrl: `${SNGR_TILES}/Red_Vial_Provincial/VectorTileServer/tile/{z}/{y}/{x}.pbf`,
        sourceLayer: 'Red_Vial_Provincial',
        minZoom: 0,
        maxZoom: 12,
        // El trazado casi no cambia: se puede cachear un día.
        tileCacheSeconds: 86_400,
      },
    ];
  }
}
