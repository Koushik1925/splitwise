import type { ThrottlerStorage } from '@nestjs/throttler';
import type Redis from 'ioredis';

// Not re-exported from the package root, so derived from the interface.
type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/**
 * Fixed-window counter with a block period, executed atomically in Redis.
 *
 * KEYS[1] hit counter for the current window, KEYS[2] block marker.
 * ARGV[1] window ttl (ms), ARGV[2] limit, ARGV[3] block duration (ms).
 * Returns { totalHits, windowTtlMs, isBlocked (0/1), blockTtlMs }.
 *
 * When the limit is exceeded the counter is cleared and a block marker is
 * set, so once the block expires the caller starts a fresh window — the same
 * behaviour as @nestjs/throttler's in-memory storage.
 */
const INCREMENT_SCRIPT = `
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  return { tonumber(ARGV[2]) + 1, blockTtl, 1, blockTtl }
end
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local windowTtl = redis.call('PTTL', KEYS[1])
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  redis.call('DEL', KEYS[1])
  return { hits, windowTtl, 1, tonumber(ARGV[3]) }
end
return { hits, windowTtl, 0, 0 }
`;

const DEFAULT_KEY_PREFIX = 'throttle:';

/**
 * Redis-backed ThrottlerStorage. The default in-memory storage keeps
 * counters per process, which would multiply the effective limit by the
 * number of API instances; Redis is already part of the stack, so counters
 * are shared here instead.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(
    private readonly redis: Redis,
    private readonly keyPrefix: string = DEFAULT_KEY_PREFIX,
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const baseKey = `${this.keyPrefix}${throttlerName}:${key}`;
    const result = (await this.redis.eval(
      INCREMENT_SCRIPT,
      2,
      `${baseKey}:hits`,
      `${baseKey}:block`,
      ttl,
      limit,
      blockDuration > 0 ? blockDuration : ttl,
    )) as [number, number, number, number];

    const [totalHits, windowTtlMs, isBlocked, blockTtlMs] = result;
    return {
      totalHits,
      timeToExpire: millisecondsToSeconds(windowTtlMs),
      isBlocked: isBlocked === 1,
      timeToBlockExpire: millisecondsToSeconds(blockTtlMs),
    };
  }
}

function millisecondsToSeconds(ms: number): number {
  return ms > 0 ? Math.ceil(ms / 1000) : 0;
}
