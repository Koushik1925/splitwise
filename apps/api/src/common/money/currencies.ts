/**
 * Supported currencies. Money is always stored as an integer count of minor
 * units; `CURRENCY_MINOR_UNIT_EXPONENT` records how many decimal places a
 * major unit has (INR: 100 paise = ₹1). Only INR is enabled in Phase 3, but
 * the code is stored on every expense and balances are never summed across
 * currencies, so adding one later is a table entry, not a migration.
 */
export enum Currency {
  INR = 'INR',
}

export const SUPPORTED_CURRENCIES: readonly Currency[] = Object.values(Currency);

export const CURRENCY_MINOR_UNIT_EXPONENT: Record<Currency, number> = {
  [Currency.INR]: 2,
};
