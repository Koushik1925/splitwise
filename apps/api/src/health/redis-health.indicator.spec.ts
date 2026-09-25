import { RedisHealthIndicator } from './redis-health.indicator';
import { HealthCheckError } from '@nestjs/terminus';
import type Redis from 'ioredis';

function makeRedisMock(ping: () => Promise<string>): Redis {
  return { ping } as unknown as Redis;
}

describe('RedisHealthIndicator', () => {
  it('reports up when Redis responds with PONG', async () => {
    const indicator = new RedisHealthIndicator(makeRedisMock(() => Promise.resolve('PONG')));
    const result = await indicator.isHealthy('redis');
    expect(result.redis.status).toBe('up');
  });

  it('throws HealthCheckError when Redis does not respond with PONG', async () => {
    const indicator = new RedisHealthIndicator(makeRedisMock(() => Promise.resolve('WRONG')));
    await expect(indicator.isHealthy('redis')).rejects.toBeInstanceOf(HealthCheckError);
  });

  it('throws HealthCheckError when the ping call rejects', async () => {
    const indicator = new RedisHealthIndicator(
      makeRedisMock(() => Promise.reject(new Error('connection refused'))),
    );
    await expect(indicator.isHealthy('redis')).rejects.toBeInstanceOf(HealthCheckError);
  });
});
