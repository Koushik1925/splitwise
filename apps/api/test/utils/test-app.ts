import type { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { getOptionsToken, type ThrottlerStorage } from '@nestjs/throttler';
import type { Connection } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { ACCESS_TOKEN_COOKIE } from '../../src/auth/auth.constants';

export const API = '/api/v1';
export const TEST_PASSWORD = 'correct-horse-battery-staple';

interface TestAppOptions {
  /** Auth-route limit per window. Defaults high so suites can register many users. */
  authRateLimit?: number;
  /** Defaults to per-app in-memory counters, isolating suites from each other. */
  throttlerStorage?: ThrottlerStorage;
}

/**
 * Boots the real AppModule with the production HTTP configuration
 * (configureApp) against MONGODB_URI / REDIS_URL from the environment.
 * Suites never wipe the database; every test user gets a unique email.
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(getOptionsToken())
    .useValue({
      throttlers: [{ name: 'default', ttl: 60_000, limit: options.authRateLimit ?? 10_000 }],
      storage: options.throttlerStorage,
    })
    .compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  // Unique indexes back several invariants under test, so wait until they exist.
  const connection = app.get<Connection>(getConnectionToken());
  await Promise.all(Object.values(connection.models).map((model) => model.init()));
  return app;
}

export interface TestUser {
  id: string;
  name: string;
  email: string;
  password: string;
  /** `access_token=<jwt>` pair, ready for a Cookie header. */
  cookie: string;
}

export function uniqueEmail(label = 'user'): string {
  return `${label}.${randomUUID()}@example.test`;
}

export function extractAuthCookie(response: request.Response): string {
  const header: unknown = response.headers['set-cookie'];
  const cookies = Array.isArray(header) ? (header as string[]) : [];
  const authCookie = cookies.find((cookie) => cookie.startsWith(`${ACCESS_TOKEN_COOKIE}=`));
  if (!authCookie) {
    throw new Error('Response did not set an access_token cookie');
  }
  return authCookie.split(';')[0];
}

export async function registerUser(app: INestApplication, label = 'user'): Promise<TestUser> {
  const credentials = { name: `Test ${label}`, email: uniqueEmail(label), password: TEST_PASSWORD };
  const response = await request(app.getHttpServer())
    .post(`${API}/auth/register`)
    .send(credentials)
    .expect(201);
  return {
    ...credentials,
    id: (response.body as { user: { id: string } }).user.id,
    cookie: extractAuthCookie(response),
  };
}

/** Request builder scoped to /api/v1, optionally authenticated as `user`. */
export function client(app: INestApplication, user?: TestUser) {
  const server = app.getHttpServer();
  const authenticate = (test: request.Test) => (user ? test.set('Cookie', user.cookie) : test);
  const withBody = (test: request.Test, body?: object) =>
    body === undefined ? test : test.send(body);

  return {
    get: (path: string) => authenticate(request(server).get(`${API}${path}`)),
    post: (path: string, body?: object) =>
      withBody(authenticate(request(server).post(`${API}${path}`)), body),
    patch: (path: string, body?: object) =>
      withBody(authenticate(request(server).patch(`${API}${path}`)), body),
    delete: (path: string) => authenticate(request(server).delete(`${API}${path}`)),
  };
}

export async function makeFriends(
  app: INestApplication,
  first: TestUser,
  second: TestUser,
): Promise<void> {
  const sent = await client(app, first)
    .post('/friends/requests', { email: second.email })
    .expect(201);
  await client(app, second)
    .post(`/friends/requests/${(sent.body as { id: string }).id}/accept`)
    .expect(200);
}
