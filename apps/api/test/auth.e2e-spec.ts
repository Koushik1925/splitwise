import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { JWT_AUDIENCE, JWT_ISSUER } from '../src/auth/auth.constants';
import {
  TEST_PASSWORD,
  client,
  createTestApp,
  extractAuthCookie,
  registerUser,
  uniqueEmail,
  type TestUser,
} from './utils/test-app';

const PROFILE_KEYS = ['createdAt', 'email', 'id', 'name', 'status', 'updatedAt'];

describe('Auth & current user (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /auth/register', () => {
    it('creates an account, sets an httpOnly session cookie, and returns only public profile fields', async () => {
      const email = uniqueEmail('register');
      const response = await client(app)
        .post('/auth/register', {
          name: '  Asha Rao  ',
          email: email.toUpperCase(),
          password: TEST_PASSWORD,
        })
        .expect(201);

      expect(Object.keys(response.body as object)).toEqual(['user']);
      const { user } = response.body as { user: Record<string, unknown> };
      expect(Object.keys(user).sort()).toEqual(PROFILE_KEYS);
      expect(user).toMatchObject({ name: 'Asha Rao', email, status: 'ACTIVE' });
      expect(JSON.stringify(response.body)).not.toMatch(/password|scrypt/i);

      const setCookie = (response.headers['set-cookie'] as unknown as string[]).join(';');
      expect(setCookie).toMatch(/access_token=/);
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/SameSite=Lax/i);
      expect(setCookie).toMatch(/Path=\//);
    });

    it('stores a salted scrypt hash, never the plaintext password', async () => {
      const user = await registerUser(app, 'hash-check');
      const stored = await app
        .get<Connection>(getConnectionToken())
        .collection('users')
        .findOne({ email: user.email });

      expect(stored?.passwordHash).toMatch(/^scrypt\$/);
      expect(stored?.passwordHash).not.toContain(TEST_PASSWORD);
      expect(JSON.stringify(stored)).not.toContain(TEST_PASSWORD);
    });

    it('rejects a duplicate email (case-insensitively) with 409', async () => {
      const existing = await registerUser(app, 'duplicate');
      await client(app)
        .post('/auth/register', {
          name: 'Someone Else',
          email: existing.email.toUpperCase(),
          password: 'another-password',
        })
        .expect(409);
    });

    it.each([
      ['missing name', { email: 'x@example.test', password: TEST_PASSWORD }],
      ['blank name', { name: '   ', email: 'x@example.test', password: TEST_PASSWORD }],
      ['invalid email', { name: 'X', email: 'not-an-email', password: TEST_PASSWORD }],
      ['short password', { name: 'X', email: 'x@example.test', password: 'short' }],
      ['over-long password', { name: 'X', email: 'x@example.test', password: 'p'.repeat(129) }],
      [
        'client-supplied status',
        { name: 'X', email: 'x@example.test', password: TEST_PASSWORD, status: 'ACTIVE' },
      ],
      [
        'client-supplied passwordHash',
        { name: 'X', email: 'x@example.test', password: TEST_PASSWORD, passwordHash: 'x' },
      ],
    ])('rejects %s with 400', async (_case, body) => {
      await client(app).post('/auth/register', body).expect(400);
    });
  });

  describe('POST /auth/login', () => {
    let user: TestUser;

    beforeAll(async () => {
      user = await registerUser(app, 'login');
    });

    it('logs in with valid credentials and sets a new session cookie', async () => {
      const response = await client(app)
        .post('/auth/login', { email: user.email.toUpperCase(), password: user.password })
        .expect(200);

      expect((response.body as { user: { id: string } }).user.id).toBe(user.id);
      expect(extractAuthCookie(response)).not.toBe(user.cookie);
    });

    it('rejects a wrong password with a generic 401 and no cookie', async () => {
      const response = await client(app)
        .post('/auth/login', { email: user.email, password: 'wrong-password' })
        .expect(401);

      expect((response.body as { message: string }).message).toBe('Invalid email or password');
      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('rejects an unknown email with a response identical to a wrong password', async () => {
      const wrongPassword = await client(app)
        .post('/auth/login', { email: user.email, password: 'wrong-password' })
        .expect(401);
      const unknownEmail = await client(app)
        .post('/auth/login', { email: uniqueEmail('nobody'), password: 'wrong-password' })
        .expect(401);

      expect(unknownEmail.body).toEqual(wrongPassword.body);
    });
  });

  describe('GET /users/me', () => {
    it('returns the authenticated user without sensitive fields', async () => {
      const user = await registerUser(app, 'me');
      const response = await client(app, user).get('/users/me').expect(200);

      expect(Object.keys(response.body as object).sort()).toEqual(PROFILE_KEYS);
      expect(response.body).toMatchObject({ id: user.id, email: user.email });
    });

    it('rejects an unauthenticated request with 401', async () => {
      await client(app).get('/users/me').expect(401);
    });

    it('rejects a tampered token with 401', async () => {
      const user = await registerUser(app, 'tamper');
      const [header, , signature] = user.cookie.replace('access_token=', '').split('.');
      const forgedPayload = Buffer.from(
        JSON.stringify({ sub: '000000000000000000000000', jti: randomUUID() }),
      ).toString('base64url');

      await client(app, { ...user, cookie: `access_token=${header}.${forgedPayload}.${signature}` })
        .get('/users/me')
        .expect(401);
    });

    it('rejects a well-formed token signed with a different secret', async () => {
      const user = await registerUser(app, 'foreign-secret');
      const forged = await new JwtService({ secret: 'not-the-server-secret' }).signAsync(
        { sub: user.id },
        { jwtid: randomUUID(), issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
      );

      await client(app, { ...user, cookie: `access_token=${forged}` })
        .get('/users/me')
        .expect(401);
    });

    it('rejects a correctly signed token whose session was never issued by the server', async () => {
      const user = await registerUser(app, 'no-session');
      const secret = app.get(ConfigService).getOrThrow<string>('JWT_SECRET');
      const forged = await new JwtService({ secret }).signAsync(
        { sub: user.id },
        { jwtid: randomUUID(), issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
      );

      await client(app, { ...user, cookie: `access_token=${forged}` })
        .get('/users/me')
        .expect(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the session server-side, so the old token stops working', async () => {
      const user = await registerUser(app, 'logout');
      await client(app, user).get('/users/me').expect(200);

      const response = await client(app, user).post('/auth/logout').expect(204);
      const setCookie = (response.headers['set-cookie'] as unknown as string[]).join(';');
      expect(setCookie).toMatch(/access_token=;/);

      // Replaying the captured cookie must fail even though the JWT hasn't expired.
      await client(app, user).get('/users/me').expect(401);
    });

    it('only revokes the session it was called with', async () => {
      const user = await registerUser(app, 'multi-session');
      const secondLogin = await client(app)
        .post('/auth/login', { email: user.email, password: user.password })
        .expect(200);
      const secondSession = { ...user, cookie: extractAuthCookie(secondLogin) };

      await client(app, user).post('/auth/logout').expect(204);

      await client(app, user).get('/users/me').expect(401);
      await client(app, secondSession).get('/users/me').expect(200);
    });

    it('succeeds without a session (idempotent)', async () => {
      await client(app).post('/auth/logout').expect(204);
    });
  });

  describe('CSRF origin check', () => {
    it('rejects state-changing requests from an untrusted Origin', async () => {
      const user = await registerUser(app, 'csrf');
      await client(app, user)
        .post('/auth/logout')
        .set('Origin', 'https://evil.example')
        .expect(403);
      // The session was not affected.
      await client(app, user).get('/users/me').expect(200);
    });

    it('accepts state-changing requests from the configured web origin', async () => {
      const user = await registerUser(app, 'csrf-ok');
      const webOrigin = app.get(ConfigService).getOrThrow<string>('CORS_ORIGIN');
      await client(app)
        .post('/auth/login', { email: user.email, password: user.password })
        .set('Origin', webOrigin)
        .expect(200);
    });
  });

  it('keeps the health check public and outside the /api/v1 prefix', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
  });
});
