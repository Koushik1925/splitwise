import { SplitMethod } from '@splitwise/shared';

export interface PreviewRow {
  userId: string;
  /** EXACT: amount in paise. PERCENTAGE: basis points. SHARES: share count. Ignored for EQUAL. */
  value: number | null;
}

/**
 * PREVIEW ONLY. Mirrors the server's largest-remainder rounding so the form
 * can show approximate shares while typing; the server recomputes every
 * amount and its response is the only authoritative result. All arithmetic is
 * on exact integers (products stay below 2^53 under the amount cap, and
 * division is done via `%`, never floating-point `/` then floor).
 *
 * Returns null when the inputs cannot produce a valid split yet.
 */
export function previewSplit(
  method: SplitMethod,
  totalMinor: number,
  rows: readonly PreviewRow[],
): Map<string, number> | null {
  if (rows.length === 0 || !Number.isSafeInteger(totalMinor) || totalMinor < 1) {
    return null;
  }
  if (method === SplitMethod.EXACT) {
    if (rows.some((row) => row.value === null || row.value < 1)) {
      return null;
    }
    return new Map(rows.map((row) => [row.userId, row.value as number]));
  }

  const weights = rows.map((row) => (method === SplitMethod.EQUAL ? 1 : row.value));
  if (weights.some((weight) => weight === null || weight < 1)) {
    return null;
  }
  const weightSum = (weights as number[]).reduce((sum, weight) => sum + weight, 0);
  const parts = rows.map((row, index) => {
    const numerator = totalMinor * (weights[index] as number);
    const remainder = numerator % weightSum;
    return { userId: row.userId, floor: (numerator - remainder) / weightSum, remainder };
  });
  const leftover = totalMinor - parts.reduce((sum, part) => sum + part.floor, 0);
  const winners = new Set(
    [...parts]
      .sort((a, b) => b.remainder - a.remainder || (a.userId < b.userId ? -1 : 1))
      .slice(0, leftover)
      .map((part) => part.userId),
  );
  return new Map(
    parts.map((part) => [part.userId, part.floor + (winners.has(part.userId) ? 1 : 0)]),
  );
}
