import { Module } from '@nestjs/common';
import { SngrEventSource } from './sngr-event.source.js';
import { SngrClient } from './sngr.client.js';

/** Integración con el web service de eventos adversos de la SNGR. */
@Module({
  providers: [SngrClient, SngrEventSource],
})
export class SngrModule {}
