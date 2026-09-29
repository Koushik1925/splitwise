import type { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { RedisThrottlerStorage } from '../src/rate-limit/redis-throttler.storage';
import { client, createTestApp, uniqueEmail } from './utils/test-app';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Rate limiting (e2e)', () => {
  let redis: Redis;
  const keyPrefix = `test:throttle:${randomUUID()}:`;

  beforeAll(() => {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  });

  afterAll(async () => {
    const keys = await redis.keys(`${keyPrefix}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    await redis.quit();
  });

  describe('auth endpoints', () => {
    let app: INestApplication;
    const limit = 3;

    beforeAll(async () => {
      app = await createTestApp({
        authRateLimit: limit,
        throttlerStorage: new RedisThrottlerStorage(redis, `${keyPrefix}app:`),
      });
    });

    afterAll(async () => {
      await app.close();
    });

    it('returns 429 with Retry-After once the login limit is exceeded', async () => {
      const attempt = { email: uniqueEmail('brute-force'), password: 'guess-guess' };
      for (let i = 0; i < limit; i++) {
        await client(app).post('/auth/login', attempt).expect(401);
      }

      const blocked = await client(app).post('/auth/login', attempt).expect(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('counts register attempts separately from login attempts', async () => {
      const response = await client(app)
        .post('/auth/register', {
          name: 'Late',
          email: uniqueEmail('late'),
          password: 'long-enough-pw',
        })
        .expect(201);
      expect(response.headers['x-ratelimit-limit']).toBe(String(limit));
    });

    it('does not throttle non-auth routes', async () => {
      for (let i = 0; i < limit + 2; i++) {
        await client(app).get('/users/me').expect(401);
      }
    });
  });

  describe('RedisThrottlerStorage', () => {
    let storage: RedisThrottlerStorage;

    beforeAll(() => {
      storage = new RedisThrottlerStorage(redis, `${keyPrefix}storage:`);
    });

    it('counts hits within a window and blocks once the limit is exceeded', async () => {
      const key = randomUUID();
      const first = await storage.increment(key, 60_000, 2, 60_000, 'default');
      const second = await storage.increment(key, 60_000, 2, 60_000, 'default');
      const third = await storage.increment(key, 60_000, 2, 60_000, 'default');

      expect(first).toMatchObject({ totalHits: 1, isBlocked: false, timeToBlockExpire: 0 });
      expect(first.timeToExpire).toBeGreaterThan(0);
      expect(second).toMatchObject({ totalHits: 2, isBlocked: false });
      expect(third.isBlocked).toBe(true);
      expect(third.timeToBlockExpire).toBeGreaterThan(0);
    });

    it('keeps different keys and throttler names independent', async () => {
      const key = randomUUID();
      await storage.increment(key, 60_000, 1, 60_000, 'default');
      await storage.increment(key, 60_000, 1, 60_000, 'default');

      const otherKey = await storage.increment(randomUUID(), 60_000, 1, 60_000, 'default');
      const otherName = await storage.increment(key, 60_000, 1, 60_000, 'other');
      expect(otherKey.isBlocked).toBe(false);
      expect(otherName.isBlocked).toBe(false);
    });

    it('starts a fresh window after the ttl expires', async () => {
      const key = randomUUID();
      await storage.increment(key, 300, 5, 300, 'default');
      await storage.increment(key, 300, 5, 300, 'default');
      await sleep(400);

      await expect(storage.increment(key, 300, 5, 300, 'default')).resolves.toMatchObject({
        totalHits: 1,
        isBlocked: false,
      });
    });

    it('releases a block after the block duration and starts counting again', async () => {
      const key = randomUUID();
      await storage.increment(key, 60_000, 1, 300, 'default');
      const blocked = await storage.increment(key, 60_000, 1, 300, 'default');
      expect(blocked.isBlocked).toBe(true);

      await sleep(400);
      await expect(storage.increment(key, 60_000, 1, 300, 'default')).resolves.toMatchObject({
        totalHits: 1,
        isBlocked: false,
      });
    });
  });
});
