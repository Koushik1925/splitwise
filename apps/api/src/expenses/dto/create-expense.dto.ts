import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Currency, SUPPORTED_CURRENCIES } from '../../common/money/currencies';
import { trimString } from '../../common/validation/transforms';
import {
  EXPENSE_DESCRIPTION_MAX_LENGTH,
  EXPENSE_MAX_PARTICIPANTS,
  SplitMethod,
} from '../schemas/expense.schema';

/**
 * Shape-only validation. Ranges, per-method field rules and reconciliation
 * are enforced by `computeSplits` (expense.rules.ts), and permissions by
 * ExpensesService. There is deliberately no field for the creator, an owed
 * amount or a balance: `forbidNonWhitelisted` rejects any attempt to send one.
 */
export class CreateExpenseParticipantDto {
  @IsMongoId()
  userId!: string;

  /** EXACT splits: this participant's share in minor units. */
  @IsOptional()
  @IsInt()
  amountMinor?: number;

  /** PERCENTAGE splits: this participant's share in basis points (10000 = 100%). */
  @IsOptional()
  @IsInt()
  percentageBps?: number;

  /** SHARES splits: this participant's share count. */
  @IsOptional()
  @IsInt()
  shares?: number;
}

export class CreateExpenseDto {
  /** Omit for an expense between friends outside any group. */
  @IsOptional()
  @IsMongoId()
  groupId?: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(EXPENSE_DESCRIPTION_MAX_LENGTH)
  description!: string;

  /** Total in minor units (paise), as a whole number. */
  @IsInt()
  amountMinor!: number;

  @IsIn(SUPPORTED_CURRENCIES)
  currency!: Currency;

  /** Who paid; defaults to the caller. Validated server-side, never trusted. */
  @IsOptional()
  @IsMongoId()
  paidBy?: string;

  @IsEnum(SplitMethod)
  splitMethod!: SplitMethod;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(EXPENSE_MAX_PARTICIPANTS)
  @ValidateNested({ each: true })
  @Type(() => CreateExpenseParticipantDto)
  participants!: CreateExpenseParticipantDto[];
}
