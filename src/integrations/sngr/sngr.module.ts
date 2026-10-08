import { Module } from '@nestjs/common';
import { SngrEventSource } from './sngr-event.source.js';
import { SngrClient } from './sngr.client.js';

/** Integración con la API de eventos por lluvias de la SNGR (monitoreo del COE). */
@Module({
  providers: [SngrClient, SngrEventSource],
})
export class SngrModule {}
