import { Type } from 'class-transformer';
import { IsInt, IsMongoId, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_EXPENSE_PAGE_SIZE = 20;
export const MAX_EXPENSE_PAGE_SIZE = 100;

export class ListExpensesQuery {
  /** Restrict to one group's expenses (the caller must be an active member). */
  @IsOptional()
  @IsMongoId()
  groupId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_EXPENSE_PAGE_SIZE)
  limit?: number;

  /** The `nextCursor` of the previous page. */
  @IsOptional()
  @IsMongoId()
  cursor?: string;
}
