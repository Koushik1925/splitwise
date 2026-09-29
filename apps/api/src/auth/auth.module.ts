import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../config/env.validation';
import { UsersModule } from '../users/users.module';
import { AuthCookieService } from './auth-cookie.service';
import { JWT_ALGORITHM, JWT_AUDIENCE, JWT_ISSUER } from './auth.constants';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PasswordHasher } from './password-hasher';
import { SessionStore } from './session.store';

@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: {
          algorithm: JWT_ALGORITHM,
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
          expiresIn: config.get('AUTH_TOKEN_TTL_SECONDS', { infer: true }),
        },
        // Pinning the algorithm rejects `alg: none` and algorithm-confusion tokens.
        verifyOptions: {
          algorithms: [JWT_ALGORITHM],
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthCookieService,
    PasswordHasher,
    SessionStore,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AuthModule {}
