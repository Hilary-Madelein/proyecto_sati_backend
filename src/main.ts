import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { ADMIN_TOKEN_HEADER } from './common/auth/admin-token.guard.js';
import { AppConfigService } from './config/app-config.service.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(AppConfigService);

  // Rutas: /api/v1/...
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.enableCors({ origin: config.get('CORS_ORIGINS'), methods: ['GET', 'POST'] });
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('SATI.EC API')
      .setDescription('Sistema de alerta temprana de inundaciones para el Ecuador')
      .setVersion('1')
      .addApiKey({ type: 'apiKey', in: 'header', name: ADMIN_TOKEN_HEADER }, ADMIN_TOKEN_HEADER)
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document);

  const port = config.get('PORT');
  await app.listen(port);
  Logger.log(`API en http://localhost:${port}/api/v1 · documentación en /api/docs`, 'Bootstrap');
}
await bootstrap();
