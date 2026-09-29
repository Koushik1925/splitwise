import { Injectable, UnauthorizedException, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomUUID } from 'node:crypto';
import { isObjectIdString } from '../common/mongo/object-id';
import type { Env } from '../config/env.validation';
import { UserStatus, type UserDocument } from '../users/schemas/user.schema';
import { toUserProfile, type UserProfileResponse } from '../users/user.presenter';
import { UsersService } from '../users/users.service';
import { INVALID_CREDENTIALS_MESSAGE } from './auth.constants';
import type { AccessTokenClaims, AuthPrincipal } from './auth.types';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import { PasswordHasher } from './password-hasher';
import { SessionStore } from './session.store';

export interface AuthResult {
  user: UserProfileResponse;
  accessToken: string;
  expiresInSeconds: number;
}

@Injectable()
export class AuthService implements OnModuleInit {
  /** Hash of a random secret, verified against when the email is unknown (see login). */
  private dummyHash?: Promise<string>;

  constructor(
    private readonly users: UsersService,
    private readonly passwordHasher: PasswordHasher,
    private readonly sessions: SessionStore,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Warm the dummy hash in the background so the first unknown-email login isn't measurably slower. */
  onModuleInit(): void {
    void this.getDummyHash();
  }

  /** @throws ConflictException when the email is already registered. */
  async register(dto: RegisterDto): Promise<AuthResult> {
    const passwordHash = await this.passwordHasher.hash(dto.password);
    const user = await this.users.create({ name: dto.name, email: dto.email, passwordHash });
    return this.startSession(user);
  }

  /**
   * Every failure path returns the same 401 message, and an unknown email
   * still pays the cost of a password verification, so neither the response
   * body nor its timing reveals whether an account exists.
   */
  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.users.findByEmailWithPasswordHash(dto.email);
    if (!user) {
      await this.passwordHasher.verify(await this.getDummyHash(), dto.password);
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const passwordMatches = await this.passwordHasher.verify(user.passwordHash, dto.password);
    if (!passwordMatches || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    return this.startSession(user);
  }

  /** Idempotent: an absent, expired, or forged token simply has nothing to revoke. */
  async logout(accessToken: string | undefined): Promise<void> {
    if (!accessToken) {
      return;
    }
    const claims = await this.verifyAccessToken(accessToken);
    if (claims) {
      await this.sessions.revoke(claims.jti);
    }
  }

  /**
   * Resolves an access token to the caller's identity: signature, algorithm,
   * issuer, audience and expiry are checked by JwtService, then the session
   * must still be live in the server-side allowlist.
   */
  async authenticate(accessToken: string): Promise<AuthPrincipal> {
    const claims = await this.verifyAccessToken(accessToken);
    if (!claims || !(await this.sessions.isActive(claims.jti, claims.sub))) {
      throw new UnauthorizedException('Authentication required');
    }
    return { userId: claims.sub, sessionId: claims.jti };
  }

  private async startSession(user: UserDocument): Promise<AuthResult> {
    const sessionId = randomUUID();
    const userId = user.id as string;
    const expiresInSeconds = this.config.get('AUTH_TOKEN_TTL_SECONDS', { infer: true });

    const accessToken = await this.jwt.signAsync({ sub: userId }, { jwtid: sessionId });
    await this.sessions.create(sessionId, userId, expiresInSeconds);

    return { user: toUserProfile(user), accessToken, expiresInSeconds };
  }

  private async verifyAccessToken(accessToken: string): Promise<AccessTokenClaims | null> {
    try {
      const claims = await this.jwt.verifyAsync<Partial<AccessTokenClaims>>(accessToken);
      if (isObjectIdString(claims.sub) && typeof claims.jti === 'string' && claims.jti.length > 0) {
        return { sub: claims.sub, jti: claims.jti };
      }
      return null;
    } catch {
      return null;
    }
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.passwordHasher.hash(randomBytes(32).toString('hex'));
    return this.dummyHash;
  }
}
