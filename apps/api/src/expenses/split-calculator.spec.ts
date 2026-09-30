import { allocateProportionally } from './split-calculator';

const id = (n: number): string => n.toString(16).padStart(24, '0');

function equalWeights(count: number) {
  return Array.from({ length: count }, (_, i) => ({ userId: id(i + 1), weight: 1 }));
}

function owed(total: number, weights: number[]): number[] {
  return allocateProportionally(
    total,
    weights.map((weight, i) => ({ userId: id(i + 1), weight })),
  ).map((allocation) => allocation.owedMinor);
}

describe('allocateProportionally', () => {
  describe('equal weights', () => {
    it('splits ₹900 three ways exactly', () => {
      expect(owed(90_000, [1, 1, 1])).toEqual([30_000, 30_000, 30_000]);
    });

    it('gives the extra paisa to the lowest user id when ₹1.00 is split three ways', () => {
      expect(owed(100, [1, 1, 1])).toEqual([34, 33, 33]);
    });

    it('splits ₹100.00 three ways as 3334 / 3333 / 3333', () => {
      expect(owed(10_000, [1, 1, 1])).toEqual([3334, 3333, 3333]);
    });

    it('spreads a two-paisa remainder over the two lowest ids', () => {
      expect(owed(10_001, [1, 1, 1])).toEqual([3334, 3334, 3333]);
    });

    it('gives a single participant the whole amount', () => {
      expect(owed(12_345, [1])).toEqual([12_345]);
    });

    it('allows zero shares when there are fewer paise than participants', () => {
      expect(owed(1, [1, 1, 1])).toEqual([1, 0, 0]);
    });

    it('allocates a zero total as all zeros', () => {
      expect(owed(0, [1, 1])).toEqual([0, 0]);
    });
  });

  describe('percentage weights (basis points)', () => {
    it('splits 50/30/20 exactly', () => {
      expect(owed(100_000, [5000, 3000, 2000])).toEqual([50_000, 30_000, 20_000]);
    });

    it('rounds 33.34 / 33.33 / 33.33 % of ₹100.01 by largest remainder', () => {
      const shares = owed(10_001, [3334, 3333, 3333]);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(10_001);
      expect(shares).toEqual([3335, 3333, 3333]);
    });

    it('handles a participant with a tiny percentage', () => {
      expect(owed(999, [1, 9999])).toEqual([0, 999]);
    });
  });

  describe('share-count weights', () => {
    it('splits 1:2:3', () => {
      expect(owed(60_000, [1, 2, 3])).toEqual([10_000, 20_000, 30_000]);
    });

    it('splits ₹1.00 as 1:2 into 33 and 67 paise', () => {
      expect(owed(100, [1, 2])).toEqual([33, 67]);
    });

    it('breaks equal remainders by ascending user id, regardless of input order', () => {
      // Three participants share 100 paise equally; the extra paisa goes to id(1) whichever order they are listed in.
      const forward = allocateProportionally(100, equalWeights(3));
      const reversed = allocateProportionally(100, [...equalWeights(3)].reverse());
      const byUser = (allocations: typeof forward) =>
        Object.fromEntries(allocations.map((a) => [a.userId, a.owedMinor]));
      expect(byUser(reversed)).toEqual(byUser(forward));
      expect(byUser(forward)[id(1)]).toBe(34);
    });
  });

  describe('large values', () => {
    it('is exact at the maximum amount with maximum weights', () => {
      const total = 10_000_000_000;
      const shares = owed(total, [1000, 999, 998, 1]);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
    });

    it('does not lose precision where a floating-point product would', () => {
      // Exact shares are 9,998,999,999.0001 and 999,999.9999; the leftover paisa goes to the larger remainder.
      expect(owed(9_999_999_999, [9999, 1])).toEqual([9_998_999_999, 1_000_000]);
    });
  });

  describe('invariants', () => {
    it('always reconciles exactly and never returns a negative share (pseudo-random sweep)', () => {
      let seed = 123_456_789;
      const next = (max: number): number => {
        seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
        return (seed % max) + 1;
      };
      for (let round = 0; round < 500; round += 1) {
        const total = next(10_000_000_000);
        const weights = Array.from({ length: next(12) }, () => next(1000));
        const shares = owed(total, weights);
        expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
        expect(shares.every((share) => Number.isInteger(share) && share >= 0)).toBe(true);
        // Nobody is more than 1 paisa away from their exact proportional share.
        const weightSum = weights.reduce((a, b) => a + b, 0);
        shares.forEach((share, i) => {
          const exact = (BigInt(total) * BigInt(weights[i])) / BigInt(weightSum);
          expect(BigInt(share) - exact === 0n || BigInt(share) - exact === 1n).toBe(true);
        });
      }
    });

    it('gives the same result for any input order', () => {
      const participants = [
        { userId: id(3), weight: 2 },
        { userId: id(1), weight: 5 },
        { userId: id(2), weight: 3 },
      ];
      const reference = Object.fromEntries(
        allocateProportionally(1001, participants).map((a) => [a.userId, a.owedMinor]),
      );
      const permutations = [
        [0, 1, 2],
        [0, 2, 1],
        [1, 0, 2],
        [1, 2, 0],
        [2, 0, 1],
        [2, 1, 0],
      ];
      for (const order of permutations) {
        const result = Object.fromEntries(
          allocateProportionally(
            1001,
            order.map((i) => participants[i]),
          ).map((a) => [a.userId, a.owedMinor]),
        );
        expect(result).toEqual(reference);
      }
    });

    it('returns allocations in the caller’s order', () => {
      const result = allocateProportionally(10, [
        { userId: id(9), weight: 1 },
        { userId: id(2), weight: 1 },
      ]);
      expect(result.map((a) => a.userId)).toEqual([id(9), id(2)]);
    });
  });

  describe('programming-error guards', () => {
    it.each([
      ['negative total', -1, [{ userId: id(1), weight: 1 }]],
      ['fractional total', 1.5, [{ userId: id(1), weight: 1 }]],
      ['no participants', 10, []],
      ['zero weight', 10, [{ userId: id(1), weight: 0 }]],
      ['fractional weight', 10, [{ userId: id(1), weight: 0.5 }]],
      [
        'duplicate participants',
        10,
        [
          { userId: id(1), weight: 1 },
          { userId: id(1), weight: 1 },
        ],
      ],
    ])('rejects %s', (_label, total, participants) => {
      expect(() => allocateProportionally(total, participants)).toThrow();
    });
  });
});
