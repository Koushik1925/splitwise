import { Body, Controller, Get, Headers, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { ListExpensesQuery } from './dto/list-expenses.query';
import type { ExpenseDetailResponse, ExpenseListResponse } from './expenses.presenter';
import { ExpensesService } from './expenses.service';

/**
 * There are intentionally no PATCH/PUT/DELETE routes: expenses are immutable
 * records of what happened, and nothing here accepts a balance.
 */
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  /** 201 for a new expense; 200 when an identical earlier request (same Idempotency-Key) is replayed. */
  @Post()
  async create(
    @CurrentUser() principal: AuthPrincipal,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Body() dto: CreateExpenseDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ExpenseDetailResponse> {
    const { expense, created } = await this.expenses.createExpense(
      principal.userId,
      idempotencyKey,
      dto,
    );
    response.status(created ? 201 : 200);
    return expense;
  }

  @Get()
  list(
    @CurrentUser() principal: AuthPrincipal,
    @Query() query: ListExpensesQuery,
  ): Promise<ExpenseListResponse> {
    return this.expenses.listExpenses(principal.userId, query);
  }

  @Get(':expenseId')
  get(
    @CurrentUser() principal: AuthPrincipal,
    @Param('expenseId', ParseObjectIdPipe) expenseId: string,
  ): Promise<ExpenseDetailResponse> {
    return this.expenses.getExpense(principal.userId, expenseId);
  }
}
