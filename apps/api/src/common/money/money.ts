/** Largest single expense: ₹10 crore, in paise. Keeps every product and sum far inside the safe-integer range. */
export const MAX_AMOUNT_MINOR = 10_000_000_000;

/** True for an integer number of minor units in [1, MAX_AMOUNT_MINOR]. */
export function isValidAmountMinor(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_AMOUNT_MINOR
  );
}

/** True for any non-negative integer that is exactly representable. */
export function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Sums integer amounts, failing loudly instead of silently losing precision.
 * BigInt is used for the accumulation so an overflow can never round.
 */
export function sumMinor(values: readonly number[]): number {
  let total = 0n;
  for (const value of values) {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`Not an integer amount of minor units: ${value}`);
    }
    total += BigInt(value);
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error('Sum of amounts exceeds the safe integer range');
  }
  return Number(total);
}
