import { Module } from '@nestjs/common';
import { ObservedRainController } from './observed-rain.controller.js';
import { ObservedRainService } from './observed-rain.service.js';

/** Lluvia observada acumulada. ObservedRainSource lo aporta la integración (hoy: satélites del INAMHI). */
@Module({
  controllers: [ObservedRainController],
  providers: [ObservedRainService],
})
export class ObservedRainModule {}
