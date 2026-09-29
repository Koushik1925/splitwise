import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from './auth/auth.module';
import { validateEnv, type Env } from './config/env.validation';
import { FriendsModule } from './friends/friends.module';
import { GroupsModule } from './groups/groups.module';
import { HealthModule } from './health/health.module';
import { QueueModule } from './queue/queue.module';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { RedisModule } from './redis/redis.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        uri: config.get('MONGODB_URI', { infer: true }),
      }),
    }),
    RedisModule,
    QueueModule,
    RateLimitModule,
    HealthModule,
    AuthModule,
    UsersModule,
    FriendsModule,
    GroupsModule,
  ],
})
export class AppModule {}
