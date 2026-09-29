import { createParamDecorator, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest, AuthPrincipal } from '../auth.types';

/**
 * Injects the principal attached by JwtAuthGuard. Throws rather than
 * returning undefined so a handler accidentally marked @Public() can never
 * run with a missing identity.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthPrincipal => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) {
      throw new UnauthorizedException('Authentication required');
    }
    return request.auth;
  },
);
