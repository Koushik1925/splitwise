import { BadRequestException } from '@nestjs/common';
import { Currency } from '../common/money/currencies';
import {
  computeSplits,
  findDebtorIds,
  hashExpenseRequest,
  involvedUserIds,
  isCreatorInvolved,
  parseIdempotencyKey,
  type ExpenseInput,
  type ParticipantInput,
} from './expense.rules';
import { SplitMethod } from './schemas/expense.schema';

const id = (n: number): string => n.toString(16).padStart(24, '0');
const [A, B, C] = [id(1), id(2), id(3)];

function input(
  overrides: Partial<ExpenseInput> & { participants: ParticipantInput[] },
): ExpenseInput {
  return {
    groupId: null,
    description: 'Dinner',
    amountMinor: 90_000,
    currency: Currency.INR,
    paidBy: A,
    splitMethod: SplitMethod.EQUAL,
    ...overrides,
  };
}

const equalThree = [{ userId: A }, { userId: B }, { userId: C }];

describe('computeSplits', () => {
  describe('EQUAL', () => {
    it('splits ₹900 between A, B and C (A paid)', () => {
      const splits = computeSplits(input({ participants: equalThree }));
      expect(splits).toEqual([
        { user: A, owedMinor: 30_000, input: null },
        { user: B, owedMinor: 30_000, input: null },
        { user: C, owedMinor: 30_000, input: null },
      ]);
    });

    it('distributes rounding remainders deterministically', () => {
      const splits = computeSplits(input({ amountMinor: 10_000, participants: equalThree }));
      expect(splits.map((s) => s.owedMinor)).toEqual([3334, 3333, 3333]);
    });

    it('accepts a payer who is not a participant (paid entirely for others)', () => {
      const splits = computeSplits(input({ participants: [{ userId: B }, { userId: C }] }));
      expect(splits.map((s) => s.owedMinor)).toEqual([45_000, 45_000]);
    });

    it('rejects an expense only the payer participates in', () => {
      expect(() => computeSplits(input({ participants: [{ userId: A }] }))).toThrow(
        BadRequestException,
      );
    });

    it('rejects supplying an amount for an EQUAL split', () => {
      expect(() =>
        computeSplits(input({ participants: [{ userId: B, amountMinor: 1 }, { userId: C }] })),
      ).toThrow(/not allowed for EQUAL/);
    });
  });

  describe('EXACT', () => {
    const exact = (amounts: number[], total = 90_000) =>
      input({
        amountMinor: total,
        splitMethod: SplitMethod.EXACT,
        participants: amounts.map((amountMinor, i) => ({ userId: id(i + 1), amountMinor })),
      });

    it('accepts amounts that add up to the total and records them as inputs', () => {
      expect(computeSplits(exact([50_000, 25_000, 15_000]))).toEqual([
        { user: A, owedMinor: 50_000, input: 50_000 },
        { user: B, owedMinor: 25_000, input: 25_000 },
        { user: C, owedMinor: 15_000, input: 15_000 },
      ]);
    });

    it('rejects amounts that do not add up (too low and too high)', () => {
      expect(() => computeSplits(exact([50_000, 25_000, 14_999]))).toThrow(/add up/);
      expect(() => computeSplits(exact([50_000, 25_000, 15_001]))).toThrow(/add up/);
    });

    it('rejects zero, negative and fractional amounts', () => {
      expect(() => computeSplits(exact([90_000, 0, 0]))).toThrow(BadRequestException);
      expect(() => computeSplits(exact([100_000, -10_000]))).toThrow(BadRequestException);
      expect(() => computeSplits(exact([45_000.5, 44_999.5]))).toThrow(BadRequestException);
    });

    it('requires an amount for every participant', () => {
      expect(() =>
        computeSplits(
          input({
            splitMethod: SplitMethod.EXACT,
            participants: [{ userId: B, amountMinor: 90_000 }, { userId: C }],
          }),
        ),
      ).toThrow(/require "amountMinor"/);
    });

    it('rejects percentage or shares fields on an EXACT split', () => {
      expect(() =>
        computeSplits(
          input({
            splitMethod: SplitMethod.EXACT,
            participants: [{ userId: B, amountMinor: 90_000, shares: 1 }],
          }),
        ),
      ).toThrow(/"shares" is not allowed/);
    });
  });

  describe('PERCENTAGE', () => {
    const pct = (values: number[], total = 90_000) =>
      input({
        amountMinor: total,
        splitMethod: SplitMethod.PERCENTAGE,
        participants: values.map((percentageBps, i) => ({ userId: id(i + 1), percentageBps })),
      });

    it('splits 50/30/20', () => {
      const splits = computeSplits(pct([5000, 3000, 2000]));
      expect(splits.map((s) => s.owedMinor)).toEqual([45_000, 27_000, 18_000]);
      expect(splits.map((s) => s.input)).toEqual([5000, 3000, 2000]);
    });

    it('splits 33.34 / 33.33 / 33.33 % with reconciled rounding', () => {
      const splits = computeSplits(pct([3334, 3333, 3333], 10_001));
      expect(splits.reduce((sum, s) => sum + s.owedMinor, 0)).toBe(10_001);
    });

    it('rejects percentages that do not total 100%', () => {
      expect(() => computeSplits(pct([3333, 3333, 3333]))).toThrow(/100%/);
      expect(() => computeSplits(pct([5000, 5001]))).toThrow(/100%/);
    });

    it('rejects zero, negative, fractional and over-100% entries', () => {
      expect(() => computeSplits(pct([10_000, 0]))).toThrow(BadRequestException);
      expect(() => computeSplits(pct([11_000, -1_000]))).toThrow(BadRequestException);
      expect(() => computeSplits(pct([5000.5, 4999.5]))).toThrow(BadRequestException);
      expect(() => computeSplits(pct([10_001]))).toThrow(BadRequestException);
    });
  });

  describe('SHARES', () => {
    const shares = (counts: number[], total = 60_000) =>
      input({
        amountMinor: total,
        splitMethod: SplitMethod.SHARES,
        participants: counts.map((count, i) => ({ userId: id(i + 1), shares: count })),
      });

    it('splits proportionally to share counts', () => {
      const splits = computeSplits(shares([1, 2, 3]));
      expect(splits.map((s) => s.owedMinor)).toEqual([10_000, 20_000, 30_000]);
      expect(splits.map((s) => s.input)).toEqual([1, 2, 3]);
    });

    it('rounds by largest remainder: ₹1.00 as 1:2 is 33 / 67', () => {
      expect(computeSplits(shares([1, 2], 100)).map((s) => s.owedMinor)).toEqual([33, 67]);
    });

    it('rejects zero, negative, fractional and oversized counts', () => {
      expect(() => computeSplits(shares([1, 0]))).toThrow(BadRequestException);
      expect(() => computeSplits(shares([1, -1]))).toThrow(BadRequestException);
      expect(() => computeSplits(shares([1, 1.5]))).toThrow(BadRequestException);
      expect(() => computeSplits(shares([1, 1001]))).toThrow(BadRequestException);
    });
  });

  describe('common validation', () => {
    it.each([0, -100, 100.5, 10_000_000_001, Number.NaN])('rejects amount %p', (amountMinor) => {
      expect(() => computeSplits(input({ amountMinor, participants: equalThree }))).toThrow(
        BadRequestException,
      );
    });

    it('rejects an unsupported currency', () => {
      expect(() =>
        computeSplits(input({ currency: 'USD' as Currency, participants: equalThree })),
      ).toThrow(/Unsupported currency/);
    });

    it('rejects duplicate participants, including differently cased ids', () => {
      expect(() => computeSplits(input({ participants: [{ userId: B }, { userId: B }] }))).toThrow(
        /only be listed once/,
      );
      const upper = 'ABCDEF' + '0'.repeat(18);
      expect(() =>
        computeSplits(
          input({ participants: [{ userId: upper }, { userId: upper.toLowerCase() }] }),
        ),
      ).toThrow(/only be listed once/);
    });

    it('rejects an empty or oversized participant list', () => {
      expect(() => computeSplits(input({ participants: [] }))).toThrow(BadRequestException);
      const many = Array.from({ length: 101 }, (_, i) => ({ userId: id(i + 1) }));
      expect(() => computeSplits(input({ paidBy: id(500), participants: many }))).toThrow(
        BadRequestException,
      );
    });

    it('rejects a split that rounds every other participant down to zero', () => {
      // 1 paisa: the payer's 1000/1001 weight takes it, B's share rounds to 0.
      expect(() =>
        computeSplits(
          input({
            amountMinor: 1,
            splitMethod: SplitMethod.SHARES,
            paidBy: A,
            participants: [
              { userId: A, shares: 1000 },
              { userId: B, shares: 1 },
            ],
          }),
        ),
      ).toThrow(/must owe a share/);
    });
  });
});

describe('findDebtorIds / isCreatorInvolved / involvedUserIds', () => {
  const splits = [
    { user: A, owedMinor: 30_000 },
    { user: B, owedMinor: 30_000 },
    { user: C, owedMinor: 0 },
  ];

  it('treats only non-payers with a positive share as debtors', () => {
    expect(findDebtorIds(A, splits)).toEqual([B]);
    expect(findDebtorIds(B, splits)).toEqual([A]);
  });

  it('lets the payer or a debtor create the expense, but nobody else', () => {
    expect(isCreatorInvolved(A, A, splits)).toBe(true); // payer
    expect(isCreatorInvolved(B, A, splits)).toBe(true); // debtor
    expect(isCreatorInvolved(C, A, splits)).toBe(false); // listed, but owes nothing
    expect(isCreatorInvolved(id(9), A, splits)).toBe(false); // stranger
  });

  it('lists the payer and every participant once', () => {
    expect(involvedUserIds(id(9), splits).sort()).toEqual([A, B, C, id(9)].sort());
    expect(involvedUserIds(A, splits).sort()).toEqual([A, B, C]);
  });
});

describe('parseIdempotencyKey', () => {
  it('accepts a uuid', () => {
    expect(parseIdempotencyKey('3f2b8c1e-0d4a-4c8e-9a51-7b6f2d1e9c00')).toBe(
      '3f2b8c1e-0d4a-4c8e-9a51-7b6f2d1e9c00',
    );
  });

  it.each([undefined, '', '   ', 'short', 'has space in it!', 'x'.repeat(129), ['a']])(
    'rejects %p',
    (value) => {
      expect(() => parseIdempotencyKey(value)).toThrow(BadRequestException);
    },
  );
});

describe('hashExpenseRequest', () => {
  const base = input({
    groupId: id(7),
    splitMethod: SplitMethod.EXACT,
    participants: [
      { userId: B, amountMinor: 40_000 },
      { userId: C, amountMinor: 50_000 },
    ],
  });

  it('is identical for the same request regardless of participant order or id casing', () => {
    const reordered = {
      ...base,
      participants: [
        { userId: C.toUpperCase(), amountMinor: 50_000 },
        { userId: B, amountMinor: 40_000 },
      ],
    };
    expect(hashExpenseRequest(reordered)).toBe(hashExpenseRequest(base));
  });

  it.each([
    ['amount', { amountMinor: 90_001 }],
    ['description', { description: 'Lunch' }],
    ['payer', { paidBy: B }],
    ['group', { groupId: null }],
    ['method', { splitMethod: SplitMethod.EQUAL }],
    [
      'a participant amount',
      {
        participants: [
          { userId: B, amountMinor: 41_000 },
          { userId: C, amountMinor: 49_000 },
        ],
      },
    ],
  ])('changes when %s changes', (_label, change) => {
    expect(hashExpenseRequest({ ...base, ...change })).not.toBe(hashExpenseRequest(base));
  });
});
