import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import type { Env } from '../config/env.validation';
import { ACCESS_TOKEN_COOKIE } from './auth.constants';

/**
 * Transport of the access token. The token lives only in an httpOnly
 * cookie — it is never returned in a response body — so page scripts
 * (including injected ones) cannot read it.
 *
 * SameSite=Lax keeps it off cross-site subrequests; `Secure` is set in
 * production. The web app and API must therefore be same-site (e.g.
 * app.example.com + api.example.com, or localhost:3000 + localhost:4000).
 */
@Injectable()
export class AuthCookieService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  set(response: Response, accessToken: string, expiresInSeconds: number): void {
    response.cookie(ACCESS_TOKEN_COOKIE, accessToken, {
      ...this.baseOptions(),
      maxAge: expiresInSeconds * 1000,
    });
  }

  clear(response: Response): void {
    response.clearCookie(ACCESS_TOKEN_COOKIE, this.baseOptions());
  }

  read(request: Request): string | undefined {
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const token = cookies?.[ACCESS_TOKEN_COOKIE];
    return typeof token === 'string' && token.length > 0 ? token : undefined;
  }

  private baseOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
      sameSite: 'lax',
      path: '/',
    };
  }
}
