import { Controller, Get } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { UserProfileResponse } from './user.presenter';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  me(@CurrentUser() principal: AuthPrincipal): Promise<UserProfileResponse> {
    return this.users.getCurrentUserProfile(principal.userId);
  }
}
