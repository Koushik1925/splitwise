import { Controller, Get, Param, Query } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import type { BalanceSummaryResponse, PairBalanceDetailResponse } from './balances.presenter';
import { BalancesService } from './balances.service';
import { GetBalancesQuery } from './dto/get-balances.query';

/** Read-only: no endpoint accepts or writes a balance. */
@Controller('balances')
export class BalancesController {
  constructor(private readonly balances: BalancesService) {}

  @Get()
  summary(
    @CurrentUser() principal: AuthPrincipal,
    @Query() query: GetBalancesQuery,
  ): Promise<BalanceSummaryResponse> {
    return this.balances.getBalances(principal.userId, query.groupId);
  }

  @Get('users/:userId')
  withUser(
    @CurrentUser() principal: AuthPrincipal,
    @Param('userId', ParseObjectIdPipe) otherUserId: string,
  ): Promise<PairBalanceDetailResponse> {
    return this.balances.getPairBalance(principal.userId, otherUserId);
  }
}
