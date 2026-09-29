import { Module } from '@nestjs/common';
import { ThrottlerModule, seconds } from '@nestjs/throttler';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { RedisThrottlerStorage } from './redis-throttler.storage';

/**
 * Per-client-IP limit applied to brute-force-sensitive endpoints (login and
 * register). Counted per route, so each has its own budget. The throttler is
 * named `default` so responses carry the standard `Retry-After` /
 * `X-RateLimit-*` headers without a name suffix.
 *
 * `ThrottlerGuard` is opted into per route (see AuthController) rather than
 * registered globally. Behind a reverse proxy, Express `trust proxy` must be
 * configured so `req.ip` is the real client address, not the proxy's.
 */
export const AUTH_RATE_LIMIT = {
  name: 'default',
  ttl: seconds(60),
  limit: 10,
} as const;

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [REDIS_CLIENT],
      useFactory: (redis: Redis) => ({
        throttlers: [AUTH_RATE_LIMIT],
        storage: new RedisThrottlerStorage(redis),
        errorMessage: 'Too many requests. Please wait and try again.',
      }),
    }),
  ],
})
export class RateLimitModule {}
