import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { AuthCookieService } from '../auth-cookie.service';
import type { AuthService } from '../auth.service';
import type { AuthenticatedRequest } from '../auth.types';
import { JwtAuthGuard } from './jwt-auth.guard';

function setup({ isPublic = false, token }: { isPublic?: boolean; token?: string }) {
  const request = {} as AuthenticatedRequest;
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(isPublic) };
  const auth = { authenticate: jest.fn() };
  const authCookie = { read: jest.fn().mockReturnValue(token) };
  const guard = new JwtAuthGuard(
    reflector as unknown as Reflector,
    auth as unknown as AuthService,
    authCookie as unknown as AuthCookieService,
  );
  return { guard, context, request, auth };
}

describe('JwtAuthGuard', () => {
  it('lets @Public() routes through without authenticating', async () => {
    const { guard, context, auth } = setup({ isPublic: true });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(auth.authenticate).not.toHaveBeenCalled();
  });

  it('rejects requests without an access token', async () => {
    const { guard, context } = setup({});
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches the verified principal to the request', async () => {
    const { guard, context, request, auth } = setup({ token: 'token' });
    auth.authenticate.mockResolvedValue({ userId: 'u1', sessionId: 's1' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(auth.authenticate).toHaveBeenCalledWith('token');
    expect(request.auth).toEqual({ userId: 'u1', sessionId: 's1' });
  });

  it('propagates authentication failures', async () => {
    const { guard, context, request, auth } = setup({ token: 'revoked' });
    auth.authenticate.mockRejectedValue(new UnauthorizedException());

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(request.auth).toBeUndefined();
  });
});
