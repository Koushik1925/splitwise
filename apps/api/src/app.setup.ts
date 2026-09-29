import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { createOriginCheckMiddleware } from './common/security/origin-check.middleware';
import type { Env } from './config/env.validation';

/** Feature routes live under /api/v1; the health check stays at /health for infrastructure probes. */
export const API_PREFIX = 'api/v1';

/**
 * HTTP-level app configuration, shared by main.ts and the e2e tests so the
 * tested app is configured exactly like the deployed one.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService<Env, true>);
  const corsOrigin = config.get('CORS_ORIGIN', { infer: true });

  app.setGlobalPrefix(API_PREFIX, { exclude: ['health'] });
  app.use(cookieParser());
  app.use(createOriginCheckMiddleware([corsOrigin]));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });
}
