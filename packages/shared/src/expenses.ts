/**
 * Expense and balance contracts: the JSON shapes and request bodies of the
 * API's `/expenses` and `/balances` endpoints.
 *
 * All money is an integer number of minor units (paise for INR); nothing in
 * this contract is a decimal. The API defines its own copies of the enums and
 * limits (it compiles to CommonJS and cannot load this TypeScript-source
 * package at runtime); `apps/api/src/shared-contract.spec.ts` fails if they
 * drift apart.
 */
import type { PublicUser } from './identity';

export enum SplitMethod {
  EQUAL = 'EQUAL',
  EXACT = 'EXACT',
  PERCENTAGE = 'PERCENTAGE',
  SHARES = 'SHARES',
}

export enum Currency {
  INR = 'INR',
}

export enum BalanceDirection {
  THEY_OWE_YOU = 'THEY_OWE_YOU',
  YOU_OWE_THEM = 'YOU_OWE_THEM',
}

export const EXPENSE_LIMITS = {
  /** ₹10 crore, in paise. */
  maxAmountMinor: 10_000_000_000,
  descriptionMaxLength: 200,
  maxParticipants: 100,
  maxSharesPerParticipant: 1000,
  /** 100% expressed in basis points (1 bp = 0.01%). */
  percentageTotalBps: 10_000,
} as const;

/** Client-supplied input for one participant; exactly one field applies per split method. */
export interface CreateExpenseParticipant {
  userId: string;
  /** EXACT: this participant's share, in minor units. */
  amountMinor?: number;
  /** PERCENTAGE: this participant's share in basis points. */
  percentageBps?: number;
  /** SHARES: this participant's positive share count. */
  shares?: number;
}

/**
 * Body of `POST /api/v1/expenses` (plus a required `Idempotency-Key` header).
 * Everything else — the creator, each participant's owed amount, balances —
 * is computed by the server and cannot be supplied.
 */
export interface CreateExpenseRequest {
  groupId?: string;
  description: string;
  amountMinor: number;
  currency: Currency;
  /** Defaults to the caller. */
  paidBy?: string;
  splitMethod: SplitMethod;
  participants: CreateExpenseParticipant[];
}

export interface ExpenseGroupRef {
  id: string;
  name: string;
}

export interface ExpenseSplitSummary {
  user: PublicUser;
  /** Authoritative amount this participant owes, in minor units. */
  owedMinor: number;
  /** What the client originally supplied (exact amount, basis points or share count); null for EQUAL. */
  input: number | null;
}

export interface ExpenseSummary {
  id: string;
  group: ExpenseGroupRef | null;
  description: string;
  amountMinor: number;
  currency: Currency;
  paidBy: PublicUser;
  createdBy: PublicUser;
  splitMethod: SplitMethod;
  /** The caller's own share of this expense (0 if they are not a participant). */
  yourShareMinor: number;
  /** What the caller paid minus their share: positive = owed money, negative = owes money. */
  yourNetMinor: number;
  createdAt: string;
}

export interface ExpenseDetail extends ExpenseSummary {
  splits: ExpenseSplitSummary[];
}

export interface ExpenseList {
  items: ExpenseSummary[];
  /** Pass as `cursor` to fetch the next page; null when there are no more. */
  nextCursor: string | null;
}

/** The caller's netted position with one other user in one currency. */
export interface PairBalance {
  counterparty: PublicUser;
  currency: Currency;
  direction: BalanceDirection;
  /** Always positive; zero-net pairs are omitted. */
  amountMinor: number;
}

export interface BalanceTotals {
  currency: Currency;
  owedToYouMinor: number;
  youOweMinor: number;
  netMinor: number;
}

export interface BalanceSummary {
  balances: PairBalance[];
  totals: BalanceTotals[];
}

/** Gross amounts for one context (a group, or friend expenses when `groupId` is null). */
export interface BalanceContext {
  groupId: string | null;
  groupName: string | null;
  theyOweYouMinor: number;
  youOweThemMinor: number;
}

export interface PairBalanceCurrencyDetail {
  currency: Currency;
  /** Gross, before netting: everything they owe you from expenses. */
  theyOweYouMinor: number;
  /** Gross, before netting: everything you owe them from expenses. */
  youOweThemMinor: number;
  /** Null when the two gross amounts cancel exactly. */
  netDirection: BalanceDirection | null;
  /** Always non-negative; the direction is in `netDirection`. */
  netMinor: number;
  contexts: BalanceContext[];
}

export interface PairBalanceDetail {
  counterparty: PublicUser;
  currencies: PairBalanceCurrencyDetail[];
}
