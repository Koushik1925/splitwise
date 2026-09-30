import { sumMinor } from '../common/money/money';

/**
 * A raw, expense-derived obligation: `debtor` owes `creditor` this much,
 * summed over expenses in one context. These are facts read straight off the
 * immutable expenses; nothing here has been netted or simplified.
 */
export interface DirectedObligation {
  debtor: string;
  creditor: string;
  currency: string;
  /** Group id, or null for expenses between friends outside any group. */
  group: string | null;
  amountMinor: number;
}

/** Gross amounts between the viewer and one counterparty in one context. */
export interface PairContextAmounts {
  group: string | null;
  theyOweYouMinor: number;
  youOweThemMinor: number;
}

/** The viewer's position with one counterparty in one currency. */
export interface PairCurrencyBalance {
  counterparty: string;
  currency: string;
  /** Gross, before netting. */
  theyOweYouMinor: number;
  /** Gross, before netting. */
  youOweThemMinor: number;
  /** Signed net: positive = they owe you, negative = you owe them, 0 = cancelled out. */
  netMinor: number;
  contexts: PairContextAmounts[];
}

export interface CurrencyTotals {
  currency: string;
  owedToYouMinor: number;
  youOweMinor: number;
  netMinor: number;
}

/**
 * Nets the viewer's obligations pairwise: for each other user and currency,
 * what they owe the viewer minus what the viewer owes them.
 *
 * Only ever nets between the *same two users*. It never reroutes debt through
 * intermediaries (A→B and B→C stay two separate obligations; the viewer only
 * ever sees rows they are a party to), never mixes currencies, and returns
 * the gross amounts alongside the net so nothing is lost by netting.
 *
 * Obligations the viewer is not a party to, self-obligations and zero rows
 * are ignored. Results are ordered by counterparty id, then currency.
 */
export function netPairBalances(
  obligations: readonly DirectedObligation[],
  viewerId: string,
): PairCurrencyBalance[] {
  interface Bucket {
    counterparty: string;
    currency: string;
    contexts: Map<string, { group: string | null; theyOwe: number[]; youOwe: number[] }>;
  }
  const buckets = new Map<string, Bucket>();

  for (const obligation of obligations) {
    if (obligation.debtor === obligation.creditor || obligation.amountMinor === 0) {
      continue;
    }
    if (!Number.isSafeInteger(obligation.amountMinor) || obligation.amountMinor < 0) {
      throw new Error('Obligation amounts must be non-negative safe integers');
    }
    const viewerIsCreditor = obligation.creditor === viewerId;
    const viewerIsDebtor = obligation.debtor === viewerId;
    if (!viewerIsCreditor && !viewerIsDebtor) {
      continue;
    }
    const counterparty = viewerIsCreditor ? obligation.debtor : obligation.creditor;
    const bucketKey = `${counterparty}|${obligation.currency}`;
    const bucket = buckets.get(bucketKey) ?? {
      counterparty,
      currency: obligation.currency,
      contexts: new Map(),
    };
    buckets.set(bucketKey, bucket);

    const contextKey = obligation.group ?? '';
    const context = bucket.contexts.get(contextKey) ?? {
      group: obligation.group,
      theyOwe: [],
      youOwe: [],
    };
    bucket.contexts.set(contextKey, context);
    (viewerIsCreditor ? context.theyOwe : context.youOwe).push(obligation.amountMinor);
  }

  return [...buckets.values()]
    .map((bucket) => {
      const contexts = [...bucket.contexts.values()]
        .map((context) => ({
          group: context.group,
          theyOweYouMinor: sumMinor(context.theyOwe),
          youOweThemMinor: sumMinor(context.youOwe),
        }))
        .sort((a, b) => (a.group ?? '').localeCompare(b.group ?? ''));
      const theyOweYouMinor = sumMinor(contexts.map((context) => context.theyOweYouMinor));
      const youOweThemMinor = sumMinor(contexts.map((context) => context.youOweThemMinor));
      return {
        counterparty: bucket.counterparty,
        currency: bucket.currency,
        theyOweYouMinor,
        youOweThemMinor,
        netMinor: theyOweYouMinor - youOweThemMinor,
        contexts,
      };
    })
    .sort(
      (a, b) =>
        a.counterparty.localeCompare(b.counterparty) || a.currency.localeCompare(b.currency),
    );
}

/**
 * Per-currency totals over already-netted pairs. Totals are built from the
 * netted figures (not the gross ones), and currencies are never summed together.
 */
export function totalsByCurrency(balances: readonly PairCurrencyBalance[]): CurrencyTotals[] {
  const byCurrency = new Map<string, { owed: number[]; owe: number[] }>();
  for (const balance of balances) {
    const entry = byCurrency.get(balance.currency) ?? { owed: [], owe: [] };
    byCurrency.set(balance.currency, entry);
    if (balance.netMinor > 0) {
      entry.owed.push(balance.netMinor);
    } else if (balance.netMinor < 0) {
      entry.owe.push(-balance.netMinor);
    }
  }
  return [...byCurrency.entries()]
    .map(([currency, { owed, owe }]) => {
      const owedToYouMinor = sumMinor(owed);
      const youOweMinor = sumMinor(owe);
      return { currency, owedToYouMinor, youOweMinor, netMinor: owedToYouMinor - youOweMinor };
    })
    .sort((a, b) => a.currency.localeCompare(b.currency));
}
