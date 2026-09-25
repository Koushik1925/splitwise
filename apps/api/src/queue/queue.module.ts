import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';

/**
 * Registers the shared BullMQ connection used for background/scheduled work
 * (e.g. overdue-settlement reminders in a later phase). No queues or
 * processors are registered yet — this is connection-level foundation only.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: {
          url: config.get('REDIS_URL', { infer: true }),
        },
      }),
    }),
  ],
})
export class QueueModule {}
