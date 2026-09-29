import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { UserProfileResponse } from '../users/user.presenter';
import { AuthCookieService } from './auth-cookie.service';
import { AuthService, type AuthResult } from './auth.service';
import { Public } from './decorators/public.decorator';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

export interface AuthResponse {
  user: UserProfileResponse;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly authCookie: AuthCookieService,
  ) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    return this.issueSession(await this.auth.register(dto), response);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    return this.issueSession(await this.auth.login(dto), response);
  }

  /** Public so a client holding an expired/invalid token can still clear its cookie. */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(this.authCookie.read(request));
    this.authCookie.clear(response);
  }

  private issueSession(result: AuthResult, response: Response): AuthResponse {
    this.authCookie.set(response, result.accessToken, result.expiresInSeconds);
    return { user: result.user };
  }
}
