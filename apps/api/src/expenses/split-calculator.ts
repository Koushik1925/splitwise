import { sumMinor } from '../common/money/money';

export interface WeightedParticipant {
  userId: string;
  /** Positive integer: a share count, or basis points. */
  weight: number;
}

export interface Allocation {
  userId: string;
  owedMinor: number;
}

/**
 * Splits `totalMinor` across participants in proportion to their integer
 * weights, with no floating point anywhere: the exact share
 * `total * weight / sumOfWeights` is computed as a BigInt quotient and
 * remainder.
 *
 * Largest-remainder method: every participant first gets the floor of their
 * exact share; the paise left over (always fewer than the participant count)
 * are handed out one each to the participants with the largest fractional
 * remainders. Remainder ties are broken by ascending user id, so the result
 * is fully deterministic and independent of the order the participants were
 * listed in. The returned allocations always sum to exactly `totalMinor`, and
 * are returned in the caller's order.
 *
 * Input is expected to be pre-validated (positive safe integers, unique ids);
 * violations are programming errors and throw.
 */
export function allocateProportionally(
  totalMinor: number,
  participants: readonly WeightedParticipant[],
): Allocation[] {
  if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) {
    throw new Error('Total must be a non-negative safe integer');
  }
  if (participants.length === 0) {
    throw new Error('At least one participant is required');
  }
  const seen = new Set<string>();
  for (const { userId, weight } of participants) {
    if (!Number.isSafeInteger(weight) || weight <= 0) {
      throw new Error('Weights must be positive safe integers');
    }
    if (seen.has(userId)) {
      throw new Error('Participants must be unique');
    }
    seen.add(userId);
  }

  const total = BigInt(totalMinor);
  const weightSum = participants.reduce((sum, { weight }) => sum + BigInt(weight), 0n);

  const parts = participants.map(({ userId, weight }, index) => {
    const numerator = total * BigInt(weight);
    return {
      index,
      userId,
      floor: numerator / weightSum,
      remainder: numerator % weightSum,
    };
  });

  const distributed = parts.reduce((sum, part) => sum + part.floor, 0n);
  const leftover = Number(total - distributed);

  const byRemainderDesc = [...parts].sort((a, b) => {
    if (a.remainder !== b.remainder) {
      return a.remainder > b.remainder ? -1 : 1;
    }
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
  });
  const bonus = new Set(byRemainderDesc.slice(0, leftover).map((part) => part.index));

  const allocations = parts.map((part) => ({
    userId: part.userId,
    owedMinor: Number(part.floor) + (bonus.has(part.index) ? 1 : 0),
  }));

  if (sumMinor(allocations.map((allocation) => allocation.owedMinor)) !== totalMinor) {
    throw new Error('Allocation does not reconcile with the total');
  }
  return allocations;
}
