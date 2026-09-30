import { netPairBalances, totalsByCurrency, type DirectedObligation } from './balance-calculator';

const id = (n: number): string => n.toString(16).padStart(24, '0');
const [A, B, C] = [id(1), id(2), id(3)];
const G1 = id(101);
const G2 = id(102);

function owes(
  debtor: string,
  creditor: string,
  amountMinor: number,
  group: string | null = null,
  currency = 'INR',
): DirectedObligation {
  return { debtor, creditor, currency, group, amountMinor };
}

describe('netPairBalances', () => {
  it('shows B and C each owing A ₹300 after A pays ₹900 for A/B/C', () => {
    const rows = [owes(B, A, 30_000), owes(C, A, 30_000)];

    const forA = netPairBalances(rows, A);
    expect(forA.map((b) => [b.counterparty, b.netMinor])).toEqual([
      [B, 30_000],
      [C, 30_000],
    ]);

    const forB = netPairBalances(rows, B);
    expect(forB).toHaveLength(1);
    expect(forB[0]).toMatchObject({ counterparty: A, netMinor: -30_000 });
  });

  it('nets A owes B ₹500 against B owes A ₹200 to A owes B ₹300, keeping the gross figures', () => {
    const rows = [owes(A, B, 50_000), owes(B, A, 20_000)];

    const [forA] = netPairBalances(rows, A);
    expect(forA).toMatchObject({
      counterparty: B,
      youOweThemMinor: 50_000,
      theyOweYouMinor: 20_000,
      netMinor: -30_000,
    });

    const [forB] = netPairBalances(rows, B);
    expect(forB).toMatchObject({
      counterparty: A,
      youOweThemMinor: 20_000,
      theyOweYouMinor: 50_000,
      netMinor: 30_000,
    });
  });

  it('reports exactly cancelling obligations as a zero net while preserving both gross figures', () => {
    const [balance] = netPairBalances([owes(A, B, 10_000), owes(B, A, 10_000)], A);
    expect(balance).toMatchObject({
      netMinor: 0,
      theyOweYouMinor: 10_000,
      youOweThemMinor: 10_000,
    });
  });

  it('does NOT simplify debts across intermediaries: A→B and B→C never become A→C', () => {
    const rows = [owes(A, B, 50_000), owes(B, C, 50_000)];

    const forA = netPairBalances(rows, A);
    expect(forA.map((b) => [b.counterparty, b.netMinor])).toEqual([[B, -50_000]]);

    const forB = netPairBalances(rows, B);
    expect(forB.map((b) => [b.counterparty, b.netMinor])).toEqual([
      [A, 50_000],
      [C, -50_000],
    ]);

    const forC = netPairBalances(rows, C);
    expect(forC.map((b) => [b.counterparty, b.netMinor])).toEqual([[B, 50_000]]);
    expect(forA.some((b) => b.counterparty === C)).toBe(false);
    expect(forC.some((b) => b.counterparty === A)).toBe(false);
  });

  it('sums obligations from several contexts and reports each context separately', () => {
    const rows = [
      owes(B, A, 10_000, null),
      owes(B, A, 5_000, G1),
      owes(A, B, 2_000, G2),
      owes(B, A, 1_000, G1),
    ];
    const [balance] = netPairBalances(rows, A);
    expect(balance.theyOweYouMinor).toBe(16_000);
    expect(balance.youOweThemMinor).toBe(2_000);
    expect(balance.netMinor).toBe(14_000);
    expect(balance.contexts).toEqual([
      { group: null, theyOweYouMinor: 10_000, youOweThemMinor: 0 },
      { group: G1, theyOweYouMinor: 6_000, youOweThemMinor: 0 },
      { group: G2, theyOweYouMinor: 0, youOweThemMinor: 2_000 },
    ]);
  });

  it('keeps currencies apart', () => {
    const rows = [owes(B, A, 10_000, null, 'INR'), owes(A, B, 500, null, 'USD')];
    const result = netPairBalances(rows, A);
    expect(result.map((b) => [b.currency, b.netMinor])).toEqual([
      ['INR', 10_000],
      ['USD', -500],
    ]);
  });

  it('ignores obligations the viewer is not part of, self-obligations and zero rows', () => {
    const rows = [owes(B, C, 99_999), owes(A, A, 500), owes(B, A, 0), owes(B, A, 700)];
    const result = netPairBalances(rows, A);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ counterparty: B, netMinor: 700 });
  });

  it('returns nothing when there are no obligations', () => {
    expect(netPairBalances([], A)).toEqual([]);
  });

  it('rejects negative and fractional amounts', () => {
    expect(() => netPairBalances([owes(B, A, -1)], A)).toThrow();
    expect(() => netPairBalances([owes(B, A, 1.5)], A)).toThrow();
  });

  it('is independent of the order of the input rows', () => {
    const rows = [owes(B, A, 1), owes(C, A, 2), owes(A, B, 3), owes(B, A, 4, G1)];
    expect(netPairBalances([...rows].reverse(), A)).toEqual(netPairBalances(rows, A));
  });
});

describe('totalsByCurrency', () => {
  it('totals netted positions: what you are owed, what you owe, and the difference', () => {
    const balances = netPairBalances(
      [owes(B, A, 30_000), owes(A, C, 10_000), owes(A, B, 5_000)],
      A,
    );
    // B nets to +25,000 (owed to you); C nets to -10,000 (you owe).
    expect(totalsByCurrency(balances)).toEqual([
      { currency: 'INR', owedToYouMinor: 25_000, youOweMinor: 10_000, netMinor: 15_000 },
    ]);
  });

  it('keeps one total per currency and skips settled pairs', () => {
    const balances = netPairBalances(
      [
        owes(B, A, 100, null, 'INR'),
        owes(C, A, 7, null, 'USD'),
        owes(B, A, 5, G1, 'EUR'),
        owes(A, B, 5, G2, 'EUR'),
      ],
      A,
    );
    expect(totalsByCurrency(balances)).toEqual([
      { currency: 'EUR', owedToYouMinor: 0, youOweMinor: 0, netMinor: 0 },
      { currency: 'INR', owedToYouMinor: 100, youOweMinor: 0, netMinor: 100 },
      { currency: 'USD', owedToYouMinor: 7, youOweMinor: 0, netMinor: 7 },
    ]);
  });
});
