import { Currency } from '../common/money/currencies';
import type { PublicUserResponse } from '../users/user.presenter';
import type { CurrencyTotals, PairCurrencyBalance } from './balance-calculator';

export enum BalanceDirection {
  THEY_OWE_YOU = 'THEY_OWE_YOU',
  YOU_OWE_THEM = 'YOU_OWE_THEM',
}

export interface PairBalanceResponse {
  counterparty: PublicUserResponse;
  currency: Currency;
  direction: BalanceDirection;
  amountMinor: number;
}

export interface BalanceTotalsResponse {
  currency: Currency;
  owedToYouMinor: number;
  youOweMinor: number;
  netMinor: number;
}

export interface BalanceSummaryResponse {
  balances: PairBalanceResponse[];
  totals: BalanceTotalsResponse[];
}

export interface BalanceContextResponse {
  groupId: string | null;
  groupName: string | null;
  theyOweYouMinor: number;
  youOweThemMinor: number;
}

export interface PairBalanceCurrencyDetailResponse {
  currency: Currency;
  theyOweYouMinor: number;
  youOweThemMinor: number;
  netDirection: BalanceDirection | null;
  netMinor: number;
  contexts: BalanceContextResponse[];
}

export interface PairBalanceDetailResponse {
  counterparty: PublicUserResponse;
  currencies: PairBalanceCurrencyDetailResponse[];
}

function requireProfile(
  profiles: ReadonlyMap<string, PublicUserResponse>,
  userId: string,
): PublicUserResponse {
  const profile = profiles.get(userId);
  if (!profile) {
    throw new Error(`Profile for user ${userId} is missing while presenting a balance`);
  }
  return profile;
}

/** Zero-net pairs are omitted; amounts are always positive with an explicit direction. */
export function toBalanceSummary(
  pairs: readonly PairCurrencyBalance[],
  totals: readonly CurrencyTotals[],
  profiles: ReadonlyMap<string, PublicUserResponse>,
): BalanceSummaryResponse {
  const balances = pairs
    .filter((pair) => pair.netMinor !== 0)
    .map((pair) => ({
      counterparty: requireProfile(profiles, pair.counterparty),
      currency: pair.currency as Currency,
      direction: pair.netMinor > 0 ? BalanceDirection.THEY_OWE_YOU : BalanceDirection.YOU_OWE_THEM,
      amountMinor: Math.abs(pair.netMinor),
    }))
    .sort(
      (a, b) =>
        a.counterparty.name.localeCompare(b.counterparty.name) ||
        a.currency.localeCompare(b.currency),
    );
  return {
    balances,
    totals: totals.map((total) => ({ ...total, currency: total.currency as Currency })),
  };
}

export function toPairBalanceDetail(
  counterparty: PublicUserResponse,
  pairs: readonly PairCurrencyBalance[],
  groupNames: ReadonlyMap<string, string>,
): PairBalanceDetailResponse {
  return {
    counterparty,
    currencies: pairs.map((pair) => ({
      currency: pair.currency as Currency,
      theyOweYouMinor: pair.theyOweYouMinor,
      youOweThemMinor: pair.youOweThemMinor,
      netDirection:
        pair.netMinor === 0
          ? null
          : pair.netMinor > 0
            ? BalanceDirection.THEY_OWE_YOU
            : BalanceDirection.YOU_OWE_THEM,
      netMinor: Math.abs(pair.netMinor),
      contexts: pair.contexts.map((context) => ({
        groupId: context.group,
        groupName: context.group ? (groupNames.get(context.group) ?? 'Unknown group') : null,
        theyOweYouMinor: context.theyOweYouMinor,
        youOweThemMinor: context.youOweThemMinor,
      })),
    })),
  };
}
