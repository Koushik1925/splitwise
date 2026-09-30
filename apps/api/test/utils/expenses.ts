import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { client, type TestUser } from './test-app';

export interface SplitBody {
  user: { id: string; name: string; email: string };
  owedMinor: number;
  input: number | null;
}

export interface ExpenseBody {
  id: string;
  group: { id: string; name: string } | null;
  description: string;
  amountMinor: number;
  currency: string;
  paidBy: { id: string };
  createdBy: { id: string };
  splitMethod: string;
  yourShareMinor: number;
  yourNetMinor: number;
  splits: SplitBody[];
  createdAt: string;
}

export interface BalanceBody {
  balances: Array<{
    counterparty: { id: string };
    currency: string;
    direction: 'THEY_OWE_YOU' | 'YOU_OWE_THEM';
    amountMinor: number;
  }>;
  totals: Array<{
    currency: string;
    owedToYouMinor: number;
    youOweMinor: number;
    netMinor: number;
  }>;
}

export const newKey = (): string => randomUUID();

/** POSTs an expense as `user` with an Idempotency-Key (a fresh one unless given). */
export function postExpense(
  app: INestApplication,
  user: TestUser | undefined,
  body: object,
  key: string | null = newKey(),
) {
  const test = client(app, user).post('/expenses', body);
  return key === null ? test : test.set('Idempotency-Key', key);
}

/** Equal split of `amountMinor` among `participants`, paid by `payer` (default: the caller). */
export function equalExpense(
  amountMinor: number,
  participants: TestUser[],
  extra: Record<string, unknown> = {},
) {
  return {
    description: 'Dinner',
    amountMinor,
    currency: 'INR',
    splitMethod: 'EQUAL',
    participants: participants.map((participant) => ({ userId: participant.id })),
    ...extra,
  };
}

/** Creates an expense that must succeed and returns it. */
export async function createExpense(
  app: INestApplication,
  user: TestUser,
  body: object,
): Promise<ExpenseBody> {
  const response = await postExpense(app, user, body).expect(201);
  return response.body as ExpenseBody;
}

export async function balancesOf(
  app: INestApplication,
  user: TestUser,
  query = '',
): Promise<BalanceBody> {
  const response = await client(app, user).get(`/balances${query}`).expect(200);
  return response.body as BalanceBody;
}

/** `[counterpartyId, signed minor units]` where positive means they owe the caller. */
export function signedBalances(body: BalanceBody): Array<[string, number]> {
  return body.balances
    .map((balance): [string, number] => [
      balance.counterparty.id,
      balance.direction === 'THEY_OWE_YOU' ? balance.amountMinor : -balance.amountMinor,
    ])
    .sort((a, b) => a[0].localeCompare(b[0]));
}
