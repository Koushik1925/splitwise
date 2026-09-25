import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Env } from '../config/env.validation';

export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * Global Redis connection, shared by health checks and (in later phases)
 * BullMQ queues/processors. Kept separate from BullmqModule registration so
 * the raw client can be reused for simple operations like health pings.
 *
 * Nest only calls onModuleDestroy on providers that implement the
 * lifecycle interface, so a plain useFactory value would leave the
 * connection open on shutdown (and hang test processes waiting for the
 * socket to close) — an inline `provide`d object exposing onModuleDestroy
 * lets Nest hook into it without a dedicated service class.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const client = new Redis(config.get('REDIS_URL', { infer: true }), {
          maxRetriesPerRequest: 3,
          lazyConnect: false,
        });
        return Object.assign(client, {
          onModuleDestroy: () => client.quit(),
        });
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
