import { ConflictException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { Env } from '../config/env.validation';
import { UserStatus, type UserDocument } from '../users/schemas/user.schema';
import type { UsersService } from '../users/users.service';
import { INVALID_CREDENTIALS_MESSAGE } from './auth.constants';
import { AuthService } from './auth.service';
import type { PasswordHasher } from './password-hasher';
import type { SessionStore } from './session.store';

const USER_ID = '64b7f0c2a1b2c3d4e5f60718';

function makeUser(overrides: Partial<Record<keyof UserDocument, unknown>> = {}): UserDocument {
  return {
    id: USER_ID,
    name: 'Asha',
    email: 'asha@example.com',
    passwordHash: 'stored-hash',
    status: UserStatus.ACTIVE,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as unknown as UserDocument;
}

function setup() {
  const users = {
    create: jest.fn(),
    findByEmailWithPasswordHash: jest.fn(),
  };
  const passwordHasher = {
    hash: jest.fn().mockResolvedValue('new-hash'),
    verify: jest.fn(),
  };
  const sessions = {
    create: jest.fn().mockResolvedValue(undefined),
    isActive: jest.fn(),
    revoke: jest.fn().mockResolvedValue(undefined),
  };
  const jwt = {
    signAsync: jest.fn().mockResolvedValue('signed.jwt.token'),
    verifyAsync: jest.fn(),
  };
  const config = { get: jest.fn().mockReturnValue(3600) };

  const service = new AuthService(
    users as unknown as UsersService,
    passwordHasher as unknown as PasswordHasher,
    sessions as unknown as SessionStore,
    jwt as unknown as JwtService,
    config as unknown as ConfigService<Env, true>,
  );
  return { service, users, passwordHasher, sessions, jwt };
}

describe('AuthService', () => {
  describe('register', () => {
    it('stores only the password hash and starts a session', async () => {
      const { service, users, passwordHasher, sessions, jwt } = setup();
      users.create.mockResolvedValue(makeUser());

      const result = await service.register({
        name: 'Asha',
        email: 'asha@example.com',
        password: 'plaintext-password',
      });

      expect(passwordHasher.hash).toHaveBeenCalledWith('plaintext-password');
      expect(users.create).toHaveBeenCalledWith({
        name: 'Asha',
        email: 'asha@example.com',
        passwordHash: 'new-hash',
      });
      const [, signOptions] = jwt.signAsync.mock.calls[0] as [unknown, { jwtid: string }];
      expect(jwt.signAsync).toHaveBeenCalledWith({ sub: USER_ID }, expect.any(Object));
      expect(sessions.create).toHaveBeenCalledWith(signOptions.jwtid, USER_ID, 3600);
      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('propagates duplicate-email conflicts', async () => {
      const { service, users } = setup();
      users.create.mockRejectedValue(new ConflictException());
      await expect(
        service.register({ name: 'A', email: 'a@example.com', password: 'password1' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('login', () => {
    it('rejects an unknown email with the generic message after a dummy verification', async () => {
      const { service, users, passwordHasher, sessions } = setup();
      users.findByEmailWithPasswordHash.mockResolvedValue(null);
      passwordHasher.verify.mockResolvedValue(false);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'whatever' }),
      ).rejects.toThrow(new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE));
      expect(passwordHasher.verify).toHaveBeenCalledTimes(1);
      expect(sessions.create).not.toHaveBeenCalled();
    });

    it('rejects a wrong password with the same generic message', async () => {
      const { service, users, passwordHasher } = setup();
      users.findByEmailWithPasswordHash.mockResolvedValue(makeUser());
      passwordHasher.verify.mockResolvedValue(false);

      await expect(service.login({ email: 'asha@example.com', password: 'wrong' })).rejects.toThrow(
        new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE),
      );
    });

    it('rejects a disabled account even with the correct password', async () => {
      const { service, users, passwordHasher, sessions } = setup();
      users.findByEmailWithPasswordHash.mockResolvedValue(
        makeUser({ status: UserStatus.DISABLED }),
      );
      passwordHasher.verify.mockResolvedValue(true);

      await expect(service.login({ email: 'asha@example.com', password: 'right' })).rejects.toThrow(
        new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE),
      );
      expect(sessions.create).not.toHaveBeenCalled();
    });

    it('starts a session for valid credentials', async () => {
      const { service, users, passwordHasher, sessions } = setup();
      users.findByEmailWithPasswordHash.mockResolvedValue(makeUser());
      passwordHasher.verify.mockResolvedValue(true);

      const result = await service.login({ email: 'asha@example.com', password: 'right' });

      expect(passwordHasher.verify).toHaveBeenCalledWith('stored-hash', 'right');
      expect(sessions.create).toHaveBeenCalledTimes(1);
      expect(result.user).toEqual(
        expect.objectContaining({ id: USER_ID, email: 'asha@example.com' }),
      );
    });
  });

  describe('authenticate', () => {
    it('returns the principal for a verified token with a live session', async () => {
      const { service, jwt, sessions } = setup();
      jwt.verifyAsync.mockResolvedValue({ sub: USER_ID, jti: 'session-1' });
      sessions.isActive.mockResolvedValue(true);

      await expect(service.authenticate('token')).resolves.toEqual({
        userId: USER_ID,
        sessionId: 'session-1',
      });
      expect(sessions.isActive).toHaveBeenCalledWith('session-1', USER_ID);
    });

    it('rejects a token that fails verification', async () => {
      const { service, jwt, sessions } = setup();
      jwt.verifyAsync.mockRejectedValue(new Error('invalid signature'));

      await expect(service.authenticate('token')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(sessions.isActive).not.toHaveBeenCalled();
    });

    it('rejects a verified token whose session was revoked', async () => {
      const { service, jwt, sessions } = setup();
      jwt.verifyAsync.mockResolvedValue({ sub: USER_ID, jti: 'session-1' });
      sessions.isActive.mockResolvedValue(false);

      await expect(service.authenticate('token')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it.each([
      { sub: 'not-an-object-id', jti: 'session-1' },
      { sub: USER_ID },
      { sub: USER_ID, jti: '' },
    ])('rejects tokens with malformed claims %p', async (claims) => {
      const { service, jwt, sessions } = setup();
      jwt.verifyAsync.mockResolvedValue(claims);
      sessions.isActive.mockResolvedValue(true);

      await expect(service.authenticate('token')).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('revokes the session of a valid token', async () => {
      const { service, jwt, sessions } = setup();
      jwt.verifyAsync.mockResolvedValue({ sub: USER_ID, jti: 'session-1' });

      await service.logout('token');
      expect(sessions.revoke).toHaveBeenCalledWith('session-1');
    });

    it('is a no-op for a missing or invalid token', async () => {
      const { service, jwt, sessions } = setup();
      jwt.verifyAsync.mockRejectedValue(new Error('expired'));

      await service.logout(undefined);
      await service.logout('expired-token');
      expect(sessions.revoke).not.toHaveBeenCalled();
    });
  });
});
