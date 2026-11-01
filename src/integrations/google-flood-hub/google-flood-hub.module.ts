import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';
import { FloodHubSource } from '../../modules/flood-hub/flood-hub-source.js';
import { FloodHubApiSource } from './flood-hub-api.source.js';
import { FloodHubGeoJsonSource } from './flood-hub-geojson.source.js';

/**
 * Integración con Google Flood Hub: último estado de los puntos de pronóstico
 * del Ecuador. Con GOOGLE_FLOOD_API_KEY usa la API oficial; sin ella, el GeoJSON
 * del demo GDE-Niño.
 */
@Global()
@Module({
  providers: [
    {
      provide: FloodHubSource,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        config.get('GOOGLE_FLOOD_API_KEY') ? new FloodHubApiSource(config) : new FloodHubGeoJsonSource(config),
    },
  ],
  exports: [FloodHubSource],
})
export class GoogleFloodHubModule {}
