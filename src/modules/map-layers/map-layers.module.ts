import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { MapLayersController } from './map-layers.controller.js';
import { MapLayersService } from './map-layers.service.js';

@Module({
  imports: [DiscoveryModule],
  controllers: [MapLayersController],
  providers: [MapLayersService],
})
export class MapLayersModule {}
