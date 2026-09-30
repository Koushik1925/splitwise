import { CURRENCY_MINOR_UNIT_EXPONENT, Currency, SUPPORTED_CURRENCIES } from './currencies';
import { isNonNegativeSafeInteger, isValidAmountMinor, MAX_AMOUNT_MINOR, sumMinor } from './money';

describe('isValidAmountMinor', () => {
  it.each([1, 100, 90_000, MAX_AMOUNT_MINOR])('accepts %d', (value) => {
    expect(isValidAmountMinor(value)).toBe(true);
  });

  it.each([
    0,
    -1,
    0.5,
    100.25,
    MAX_AMOUNT_MINOR + 1,
    Number.NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    '100',
    null,
    undefined,
  ])('rejects %p', (value) => {
    expect(isValidAmountMinor(value)).toBe(false);
  });
});

describe('isNonNegativeSafeInteger', () => {
  it('accepts zero and positive integers only', () => {
    expect(isNonNegativeSafeInteger(0)).toBe(true);
    expect(isNonNegativeSafeInteger(5)).toBe(true);
    expect(isNonNegativeSafeInteger(-1)).toBe(false);
    expect(isNonNegativeSafeInteger(1.5)).toBe(false);
  });
});

describe('sumMinor', () => {
  it('sums integers exactly', () => {
    expect(sumMinor([3334, 3333, 3333])).toBe(10_000);
    expect(sumMinor([])).toBe(0);
  });

  it('rejects fractional amounts', () => {
    expect(() => sumMinor([1, 0.5])).toThrow();
  });

  it('rejects sums beyond the safe integer range instead of rounding', () => {
    expect(() => sumMinor([Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER])).toThrow();
  });
});

describe('currencies', () => {
  it('supports INR with two minor-unit digits', () => {
    expect(SUPPORTED_CURRENCIES).toEqual([Currency.INR]);
    expect(CURRENCY_MINOR_UNIT_EXPONENT[Currency.INR]).toBe(2);
  });
});
