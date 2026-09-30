import { Currency } from '../common/money/currencies';
import type { PublicUserResponse } from '../users/user.presenter';
import type { ExpenseDocument } from './schemas/expense.schema';
import { SplitMethod } from './schemas/expense.schema';

export interface ExpenseGroupResponse {
  id: string;
  name: string;
}

export interface ExpenseSplitResponse {
  user: PublicUserResponse;
  owedMinor: number;
  input: number | null;
}

export interface ExpenseSummaryResponse {
  id: string;
  group: ExpenseGroupResponse | null;
  description: string;
  amountMinor: number;
  currency: Currency;
  paidBy: PublicUserResponse;
  createdBy: PublicUserResponse;
  splitMethod: SplitMethod;
  yourShareMinor: number;
  yourNetMinor: number;
  createdAt: string;
}

export interface ExpenseDetailResponse extends ExpenseSummaryResponse {
  splits: ExpenseSplitResponse[];
}

export interface ExpenseListResponse {
  items: ExpenseSummaryResponse[];
  nextCursor: string | null;
}

/** Lookups a response needs, loaded in bulk by the service. */
export interface ExpensePresentationContext {
  viewerId: string;
  profiles: ReadonlyMap<string, PublicUserResponse>;
  groupNames: ReadonlyMap<string, string>;
}

/** Every user an expense refers to; used to batch-load their profiles. */
export function userIdsOf(expense: ExpenseDocument): string[] {
  return [
    expense.paidBy.toHexString(),
    expense.createdBy.toHexString(),
    ...expense.splits.map((split) => split.user.toHexString()),
  ];
}

/**
 * Unlike the friends/groups presenters, a missing profile is an error rather
 * than a silently dropped row: an omitted split would misstate who owes what.
 * (Profiles of disabled users still resolve, so history stays complete.)
 */
function requireProfile(
  profiles: ReadonlyMap<string, PublicUserResponse>,
  userId: string,
): PublicUserResponse {
  const profile = profiles.get(userId);
  if (!profile) {
    throw new Error(`Profile for user ${userId} is missing while presenting an expense`);
  }
  return profile;
}

export function toExpenseSummary(
  expense: ExpenseDocument,
  context: ExpensePresentationContext,
): ExpenseSummaryResponse {
  const { viewerId, profiles, groupNames } = context;
  const paidById = expense.paidBy.toHexString();
  const yourShareMinor = expense.splits
    .filter((split) => split.user.toHexString() === viewerId)
    .reduce((sum, split) => sum + split.owedMinor, 0);
  const youPaidMinor = paidById === viewerId ? expense.amountMinor : 0;

  return {
    id: expense.id as string,
    group: expense.group
      ? {
          id: expense.group.toHexString(),
          name: groupNames.get(expense.group.toHexString()) ?? 'Unknown group',
        }
      : null,
    description: expense.description,
    amountMinor: expense.amountMinor,
    currency: expense.currency,
    paidBy: requireProfile(profiles, paidById),
    createdBy: requireProfile(profiles, expense.createdBy.toHexString()),
    splitMethod: expense.splitMethod,
    yourShareMinor,
    yourNetMinor: youPaidMinor - yourShareMinor,
    createdAt: expense.createdAt.toISOString(),
  };
}

export function toExpenseDetail(
  expense: ExpenseDocument,
  context: ExpensePresentationContext,
): ExpenseDetailResponse {
  return {
    ...toExpenseSummary(expense, context),
    splits: expense.splits.map((split) => ({
      user: requireProfile(context.profiles, split.user.toHexString()),
      owedMinor: split.owedMinor,
      input: split.input,
    })),
  };
}
