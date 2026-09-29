import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

const SESSION_KEY_PREFIX = 'auth:session:';

/**
 * Server-side allowlist of live sessions, keyed by the access token's `jti`.
 *
 * A JWT alone cannot be revoked before it expires; checking this allowlist
 * on every authenticated request is what makes logout (and future
 * "sign out everywhere" / account-disable flows) take effect immediately.
 * It fails closed: if a session record is missing for any reason, the token
 * is rejected.
 */
@Injectable()
export class SessionStore {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async create(sessionId: string, userId: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(sessionKey(sessionId), userId, 'EX', ttlSeconds);
  }

  async isActive(sessionId: string, userId: string): Promise<boolean> {
    return (await this.redis.get(sessionKey(sessionId))) === userId;
  }

  async revoke(sessionId: string): Promise<void> {
    await this.redis.del(sessionKey(sessionId));
  }
}

function sessionKey(sessionId: string): string {
  return `${SESSION_KEY_PREFIX}${sessionId}`;
}
