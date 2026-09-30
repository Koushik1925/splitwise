import { Currency, EXPENSE_LIMITS } from '@splitwise/shared';

const CURRENCY_SYMBOL: Record<Currency, string> = {
  [Currency.INR]: '₹',
};

/**
 * Parses what a person typed ("900", "1,250.5") into whole paise by string
 * handling only — no floating point ever touches an amount. Returns null for
 * anything that is not a positive amount with at most two decimals.
 */
export function parseAmountToMinor(input: string): number | null {
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(input.replace(/[,\s]/g, ''));
  if (!match) {
    return null;
  }
  const minor = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(minor) || minor < 1 || minor > EXPENSE_LIMITS.maxAmountMinor) {
    return null;
  }
  return minor;
}

/** "33.33" -> 3333 basis points (10000 = 100%). Null when not a valid 0.01–100 percentage. */
export function parsePercentToBps(input: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) {
    return null;
  }
  const bps = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return bps >= 1 && bps <= EXPENSE_LIMITS.percentageTotalBps ? bps : null;
}

/** Display only: 123456 -> "₹1,234.56". Works on integers, so nothing is rounded. */
export function formatMinor(minor: number, currency: Currency = Currency.INR): string {
  const abs = Math.abs(minor);
  const major = (abs - (abs % 100)) / 100;
  const paise = String(abs % 100).padStart(2, '0');
  const sign = minor < 0 ? '-' : '';
  return `${sign}${CURRENCY_SYMBOL[currency]}${new Intl.NumberFormat('en-IN').format(major)}.${paise}`;
}
