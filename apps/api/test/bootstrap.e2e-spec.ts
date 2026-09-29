import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

/**
 * Boots the app through NestFactory exactly like main.ts. The other suites
 * use @nestjs/testing, which loads the HTTP driver from its own install
 * location — so they keep passing even if npm hoists @nestjs/core away from
 * @nestjs/platform-express, while the real server fails to start with
 * "No driver (HTTP) has been selected". This catches that.
 */
describe('Application bootstrap (e2e)', () => {
  it('starts via NestFactory with the production configuration', async () => {
    const app = await NestFactory.create(AppModule, { logger: false });
    try {
      configureApp(app);
      await app.init();
      await request(app.getHttpServer()).get('/health').expect(200);
      await request(app.getHttpServer()).get('/api/v1/users/me').expect(401);
    } finally {
      await app.close();
    }
  });
});
