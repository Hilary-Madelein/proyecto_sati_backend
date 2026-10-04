import { Module } from '@nestjs/common';
import { WrfLayersProvider } from './wrf-layers.provider.js';

/** Integración con las capas del modelo WRF del INAMHI (WMS de GeoGLOWS). */
@Module({
  providers: [WrfLayersProvider],
})
export class InamhiWrfModule {}
