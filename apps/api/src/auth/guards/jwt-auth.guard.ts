import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthCookieService } from '../auth-cookie.service';
import { AuthService } from '../auth.service';
import type { AuthenticatedRequest } from '../auth.types';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Registered globally (APP_GUARD in AuthModule): every route requires a
 * valid session unless it is explicitly marked @Public(). On success the
 * verified principal is attached to the request for @CurrentUser().
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly authCookie: AuthCookieService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const accessToken = this.authCookie.read(request);
    if (!accessToken) {
      throw new UnauthorizedException('Authentication required');
    }

    request.auth = await this.auth.authenticate(accessToken);
    return true;
  }
}
