import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { AppConfigModule } from './config/config.module.js';
import { GeoglowsModule } from './integrations/geoglows/geoglows.module.js';
import { InamhiHydroviewerModule } from './integrations/inamhi-hydroviewer/inamhi-hydroviewer.module.js';
import { InamhiWrfModule } from './integrations/inamhi-wrf/inamhi-wrf.module.js';
import { SatellitePrecipitationModule } from './integrations/satellite-precipitation/satellite-precipitation.module.js';
import { SngrModule } from './integrations/sngr/sngr.module.js';
import { EventsModule } from './modules/events/events.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { HydrologyModule } from './modules/hydrology/hydrology.module.js';
import { IngestionModule } from './modules/ingestion/ingestion.module.js';
import { MapLayersModule } from './modules/map-layers/map-layers.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { RainForecastModule } from './modules/rain-forecast/rain-forecast.module.js';
import { StorageModule } from './storage/storage.module.js';

@Module({
  imports: [
    // Infraestructura
    AppConfigModule,
    // Memoria o PostgreSQL, según STORAGE
    ...StorageModule.forRoot(),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),

    // Dominio propio
    EventsModule,
    IngestionModule,
    MapLayersModule,
    HydrologyModule,
    RainForecastModule,
    NotificationsModule,
    HealthModule,

    // Integraciones con APIs externas: para agregar una, se importa aquí su módulo.
    SngrModule,
    InamhiWrfModule,
    SatellitePrecipitationModule,
    GeoglowsModule,
    InamhiHydroviewerModule,
  ],
})
export class AppModule {}
