import { Global, Module } from '@nestjs/common';
import { FloodHubSource } from '../../modules/flood-hub/flood-hub-source.js';
import { FloodHubGeoJsonSource } from './flood-hub-geojson.source.js';

/** Integración con Google Flood Hub: último estado de los puntos de pronóstico del Ecuador. */
@Global()
@Module({
  providers: [{ provide: FloodHubSource, useClass: FloodHubGeoJsonSource }],
  exports: [FloodHubSource],
})
export class GoogleFloodHubModule {}
