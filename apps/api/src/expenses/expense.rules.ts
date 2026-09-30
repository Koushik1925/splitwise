import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { normalizeObjectId } from '../common/mongo/object-id';
import { Currency, SUPPORTED_CURRENCIES } from '../common/money/currencies';
import { isValidAmountMinor, sumMinor } from '../common/money/money';
import { EXPENSE_MAX_PARTICIPANTS, SplitMethod } from './schemas/expense.schema';
import { allocateProportionally } from './split-calculator';

/** Percentages are integer basis points: 10000 = 100%. */
export const PERCENTAGE_TOTAL_BPS = 10_000;
export const MAX_SHARES_PER_PARTICIPANT = 1000;

export interface ParticipantInput {
  userId: string;
  amountMinor?: number;
  percentageBps?: number;
  shares?: number;
}

export interface ExpenseInput {
  groupId: string | null;
  description: string;
  amountMinor: number;
  currency: Currency;
  /** Resolved payer (the caller when the client omitted it). */
  paidBy: string;
  splitMethod: SplitMethod;
  participants: ParticipantInput[];
}

export interface ComputedSplit {
  user: string;
  owedMinor: number;
  /** The client-supplied exact amount, basis points or share count; null for EQUAL. */
  input: number | null;
}

/** The single input field that applies to each split method. */
const METHOD_FIELD: Record<SplitMethod, keyof Omit<ParticipantInput, 'userId'> | null> = {
  [SplitMethod.EQUAL]: null,
  [SplitMethod.EXACT]: 'amountMinor',
  [SplitMethod.PERCENTAGE]: 'percentageBps',
  [SplitMethod.SHARES]: 'shares',
};

const INPUT_FIELDS = ['amountMinor', 'percentageBps', 'shares'] as const;

/**
 * Validates the financial inputs of an expense and computes every
 * participant's owed amount. This is the only place amounts are derived:
 * nothing a client sends for a participant is stored as an owed amount
 * without passing the reconciliation checks here.
 *
 * All arithmetic is on integer minor units (BigInt inside the allocator);
 * violations throw 400. The result is in the caller's participant order.
 */
export function computeSplits(input: ExpenseInput): ComputedSplit[] {
  if (!isValidAmountMinor(input.amountMinor)) {
    throw new BadRequestException('amountMinor must be a whole number of minor units above zero');
  }
  if (!SUPPORTED_CURRENCIES.includes(input.currency)) {
    throw new BadRequestException(
      `Unsupported currency. Supported: ${SUPPORTED_CURRENCIES.join(', ')}`,
    );
  }
  const { participants } = input;
  if (participants.length < 1 || participants.length > EXPENSE_MAX_PARTICIPANTS) {
    throw new BadRequestException(
      `An expense needs between 1 and ${EXPENSE_MAX_PARTICIPANTS} participants`,
    );
  }

  const ids = participants.map((participant) => normalizeObjectId(participant.userId));
  if (new Set(ids).size !== ids.length) {
    throw new BadRequestException('Each participant can only be listed once');
  }

  const requiredField = METHOD_FIELD[input.splitMethod];
  participants.forEach((participant) => {
    for (const field of INPUT_FIELDS) {
      const present = participant[field] !== undefined;
      if (field === requiredField && !present) {
        throw new BadRequestException(
          `${input.splitMethod} splits require "${field}" for every participant`,
        );
      }
      if (field !== requiredField && present) {
        throw new BadRequestException(`"${field}" is not allowed for ${input.splitMethod} splits`);
      }
    }
  });

  const owed = allocate(input, ids);
  const splits = ids.map((user, index) => ({
    user,
    owedMinor: owed[index],
    input: requiredField ? (participants[index][requiredField] ?? null) : null,
  }));

  if (sumMinor(splits.map((split) => split.owedMinor)) !== input.amountMinor) {
    // Every branch above reconciles by construction; this is the last line of defence.
    throw new Error('Computed splits do not reconcile with the expense total');
  }
  if (findDebtorIds(input.paidBy, splits).length === 0) {
    throw new BadRequestException(
      'At least one participant other than the payer must owe a share of this expense',
    );
  }
  return splits;
}

function allocate(input: ExpenseInput, ids: string[]): number[] {
  const { participants, amountMinor, splitMethod } = input;
  switch (splitMethod) {
    case SplitMethod.EQUAL:
      return weighted(
        amountMinor,
        ids,
        ids.map(() => 1),
      );

    case SplitMethod.SHARES: {
      const shares = participants.map((participant) => participant.shares);
      shares.forEach((count) => {
        if (
          typeof count !== 'number' ||
          !Number.isSafeInteger(count) ||
          count < 1 ||
          count > MAX_SHARES_PER_PARTICIPANT
        ) {
          throw new BadRequestException(
            `shares must be whole numbers from 1 to ${MAX_SHARES_PER_PARTICIPANT}`,
          );
        }
      });
      return weighted(amountMinor, ids, shares as number[]);
    }

    case SplitMethod.PERCENTAGE: {
      const bps = participants.map((participant) => participant.percentageBps);
      bps.forEach((value) => {
        if (
          typeof value !== 'number' ||
          !Number.isSafeInteger(value) ||
          value < 1 ||
          value > PERCENTAGE_TOTAL_BPS
        ) {
          throw new BadRequestException(
            'percentageBps must be whole basis points from 1 to 10000 (100% = 10000)',
          );
        }
      });
      if (sumMinor(bps as number[]) !== PERCENTAGE_TOTAL_BPS) {
        throw new BadRequestException(
          'Percentages must add up to exactly 100% (10000 basis points)',
        );
      }
      return weighted(amountMinor, ids, bps as number[]);
    }

    case SplitMethod.EXACT: {
      const amounts = participants.map((participant) => participant.amountMinor);
      amounts.forEach((value) => {
        if (!isValidAmountMinor(value)) {
          throw new BadRequestException(
            'Each exact amount must be a whole number of minor units above zero',
          );
        }
      });
      if (sumMinor(amounts as number[]) !== amountMinor) {
        throw new BadRequestException('Exact amounts must add up to the expense total');
      }
      return amounts as number[];
    }
  }
}

function weighted(total: number, ids: string[], weights: number[]): number[] {
  return allocateProportionally(
    total,
    ids.map((userId, index) => ({ userId, weight: weights[index] })),
  ).map((allocation) => allocation.owedMinor);
}

/**
 * Debtors: participants other than the payer who owe something. The payer's
 * own share (if listed) is their consumption, not a debt to anyone.
 */
export function findDebtorIds(
  paidBy: string,
  splits: ReadonlyArray<Pick<ComputedSplit, 'user' | 'owedMinor'>>,
): string[] {
  return splits
    .filter((split) => split.user !== paidBy && split.owedMinor > 0)
    .map((split) => split.user);
}

/**
 * Nobody may record an expense purely between other people: the creator must
 * be the payer or one of the debtors.
 */
export function isCreatorInvolved(
  creatorId: string,
  paidBy: string,
  splits: ReadonlyArray<Pick<ComputedSplit, 'user' | 'owedMinor'>>,
): boolean {
  return creatorId === paidBy || findDebtorIds(paidBy, splits).includes(creatorId);
}

/** Everyone named in an expense: the payer plus every participant, unique. */
export function involvedUserIds(
  paidBy: string,
  splits: ReadonlyArray<Pick<ComputedSplit, 'user'>>,
): string[] {
  return [...new Set([paidBy, ...splits.map((split) => split.user)])];
}

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;

/** Validates the `Idempotency-Key` header; required for expense creation. */
export function parseIdempotencyKey(header: unknown): string {
  if (typeof header !== 'string' || header.trim() === '') {
    throw new BadRequestException('The Idempotency-Key header is required');
  }
  const key = header.trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new BadRequestException(
      'Idempotency-Key must be 8-128 characters: letters, digits, and _ . : -',
    );
  }
  return key;
}

/**
 * Hash of the semantically meaningful request, independent of participant
 * order and id casing. Two requests with the same hash ask for the same
 * expense; a reused key with a different hash is a conflict.
 */
export function hashExpenseRequest(input: ExpenseInput): string {
  const canonical = {
    groupId: input.groupId,
    description: input.description,
    amountMinor: input.amountMinor,
    currency: input.currency,
    paidBy: input.paidBy,
    splitMethod: input.splitMethod,
    participants: input.participants
      .map((participant) => ({
        userId: normalizeObjectId(participant.userId),
        amountMinor: participant.amountMinor ?? null,
        percentageBps: participant.percentageBps ?? null,
        shares: participant.shares ?? null,
      }))
      .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0)),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
