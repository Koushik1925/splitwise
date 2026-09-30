import type { INestApplication } from '@nestjs/common';
import {
  balancesOf,
  createExpense,
  equalExpense,
  signedBalances,
  type BalanceBody,
} from './utils/expenses';
import { client, createTestApp, makeFriends, registerUser, type TestUser } from './utils/test-app';

interface PairDetailBody {
  counterparty: { id: string };
  currencies: Array<{
    currency: string;
    theyOweYouMinor: number;
    youOweThemMinor: number;
    netDirection: 'THEY_OWE_YOU' | 'YOU_OWE_THEM' | null;
    netMinor: number;
    contexts: Array<{
      groupId: string | null;
      groupName: string | null;
      theyOweYouMinor: number;
      youOweThemMinor: number;
    }>;
  }>;
}

describe('Balances (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const as = (user?: TestUser) => client(app, user);

  /** Fresh users every time, so each scenario's balances are fully deterministic. */
  async function trio(mutualFriends = true): Promise<[TestUser, TestUser, TestUser]> {
    const [a, b, c] = await Promise.all(
      ['a', 'b', 'c'].map((label) => registerUser(app, `bal-${label}`)),
    );
    await makeFriends(app, a, b);
    await makeFriends(app, a, c);
    if (mutualFriends) {
      await makeFriends(app, b, c);
    }
    return [a, b, c];
  }

  async function createGroup(owner: TestUser, members: TestUser[]): Promise<string> {
    const group = await as(owner).post('/groups', { name: 'Flat' }).expect(201);
    const groupId = (group.body as { id: string }).id;
    for (const member of members) {
      await as(owner).post(`/groups/${groupId}/members`, { userId: member.id }).expect(201);
    }
    return groupId;
  }

  it('starts empty', async () => {
    const loner = await registerUser(app, 'bal-loner');
    expect(await balancesOf(app, loner)).toEqual({ balances: [], totals: [] });
  });

  it('shows B and C each owing A ₹300 after A pays ₹900 for A, B and C', async () => {
    const [a, b, c] = await trio();
    await createExpense(app, a, equalExpense(90_000, [a, b, c]));

    expect(signedBalances(await balancesOf(app, a))).toEqual(
      [
        [b.id, 30_000],
        [c.id, 30_000],
      ].sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    );
    expect(signedBalances(await balancesOf(app, b))).toEqual([[a.id, -30_000]]);
    expect(signedBalances(await balancesOf(app, c))).toEqual([[a.id, -30_000]]);
    // A owes nobody anything.
    expect((await balancesOf(app, a)).balances.every((x) => x.direction === 'THEY_OWE_YOU')).toBe(
      true,
    );
  });

  it('reports totals from the netted positions', async () => {
    const [a, b, c] = await trio();
    await createExpense(app, a, equalExpense(90_000, [a, b, c]));
    await createExpense(app, b, equalExpense(20_000, [a, b])); // A owes B 10,000

    const forA = await balancesOf(app, a);
    expect(forA.totals).toEqual([
      { currency: 'INR', owedToYouMinor: 50_000, youOweMinor: 0, netMinor: 50_000 },
    ]);
    // B: A owes B nothing net (30,000 - 10,000 = A's ledger says B owes A 20,000).
    expect(signedBalances(forA)).toContainEqual([b.id, 20_000]);
  });

  it('nets A owes B ₹500 against B owes A ₹200 into A owes B ₹300', async () => {
    const [a, b] = await trio();
    // B pays ₹500, A owes all of it; A pays ₹200, B owes all of it.
    await createExpense(app, b, {
      description: 'B paid',
      amountMinor: 50_000,
      currency: 'INR',
      splitMethod: 'EXACT',
      participants: [{ userId: a.id, amountMinor: 50_000 }],
    });
    await createExpense(app, a, {
      description: 'A paid',
      amountMinor: 20_000,
      currency: 'INR',
      splitMethod: 'EXACT',
      participants: [{ userId: b.id, amountMinor: 20_000 }],
    });

    expect(signedBalances(await balancesOf(app, a))).toEqual([[b.id, -30_000]]);
    expect(signedBalances(await balancesOf(app, b))).toEqual([[a.id, 30_000]]);

    // The gross, expense-derived amounts survive netting.
    const detail = (await as(a).get(`/balances/users/${b.id}`).expect(200)).body as PairDetailBody;
    expect(detail.currencies).toEqual([
      expect.objectContaining({
        currency: 'INR',
        theyOweYouMinor: 20_000,
        youOweThemMinor: 50_000,
        netDirection: 'YOU_OWE_THEM',
        netMinor: 30_000,
      }),
    ]);
  });

  it('omits pairs that cancel exactly from the summary but still reports them in the detail', async () => {
    const [a, b] = await trio();
    const pay = (payer: TestUser, debtor: TestUser) =>
      createExpense(app, payer, {
        description: 'even',
        amountMinor: 10_000,
        currency: 'INR',
        splitMethod: 'EXACT',
        participants: [{ userId: debtor.id, amountMinor: 10_000 }],
      });
    await pay(a, b);
    await pay(b, a);

    expect((await balancesOf(app, a)).balances).toEqual([]);
    const detail = (await as(a).get(`/balances/users/${b.id}`).expect(200)).body as PairDetailBody;
    expect(detail.currencies[0]).toMatchObject({
      theyOweYouMinor: 10_000,
      youOweThemMinor: 10_000,
      netDirection: null,
      netMinor: 0,
    });
  });

  it('does NOT simplify debts across intermediaries (A owes B, B owes C stays two debts)', async () => {
    const [a, b, c] = await trio(); // A-B, A-C and B-C are all friends
    // B pays, A owes ₹500.
    await createExpense(app, b, {
      description: 'A owes B',
      amountMinor: 50_000,
      currency: 'INR',
      splitMethod: 'EXACT',
      participants: [{ userId: a.id, amountMinor: 50_000 }],
    });
    // C pays, B owes ₹500.
    await createExpense(app, c, {
      description: 'B owes C',
      amountMinor: 50_000,
      currency: 'INR',
      splitMethod: 'EXACT',
      participants: [{ userId: b.id, amountMinor: 50_000 }],
    });

    expect(signedBalances(await balancesOf(app, a))).toEqual([[b.id, -50_000]]);
    expect(signedBalances(await balancesOf(app, b))).toEqual(
      [
        [a.id, 50_000],
        [c.id, -50_000],
      ].sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    );
    expect(signedBalances(await balancesOf(app, c))).toEqual([[b.id, 50_000]]);

    // A and C never dealt with each other, so there is nothing to show.
    await as(a).get(`/balances/users/${c.id}`).expect(404);
    await as(c).get(`/balances/users/${a.id}`).expect(404);
  });

  it('never lets a third party see or affect a pair they are not part of', async () => {
    const [a, b, c] = await trio();
    await createExpense(app, a, equalExpense(20_000, [a, b]));
    expect(signedBalances(await balancesOf(app, c))).toEqual([]);
    await as(c).get(`/balances/users/${a.id}`).expect(404);
  });

  it('breaks a pair down by context: friend expenses and each group separately', async () => {
    const [a, b] = await trio();
    const groupId = await createGroup(a, [b]);
    await createExpense(app, a, equalExpense(10_000, [a, b])); // friend context: B owes 5,000
    await createExpense(app, a, equalExpense(20_000, [a, b], { groupId })); // group: B owes 10,000
    await createExpense(app, b, equalExpense(4_000, [a, b], { groupId })); // group: A owes 2,000

    const detail = (await as(a).get(`/balances/users/${b.id}`).expect(200)).body as PairDetailBody;
    const [inr] = detail.currencies;
    expect(inr).toMatchObject({
      theyOweYouMinor: 15_000,
      youOweThemMinor: 2_000,
      netDirection: 'THEY_OWE_YOU',
      netMinor: 13_000,
    });
    expect(inr.contexts).toEqual(
      expect.arrayContaining([
        { groupId: null, groupName: null, theyOweYouMinor: 5_000, youOweThemMinor: 0 },
        { groupId, groupName: 'Flat', theyOweYouMinor: 10_000, youOweThemMinor: 2_000 },
      ]),
    );
    expect(inr.contexts).toHaveLength(2);
  });

  it('scopes to one group with ?groupId, and hides groups from non-members', async () => {
    const [a, b, c] = await trio();
    const groupId = await createGroup(a, [b]);
    await createExpense(app, a, equalExpense(10_000, [a, b])); // friend context
    await createExpense(app, a, equalExpense(20_000, [a, b], { groupId })); // group context
    await createExpense(app, a, equalExpense(6_000, [a, c])); // friend context, other pair

    expect(signedBalances(await balancesOf(app, a, `?groupId=${groupId}`))).toEqual([
      [b.id, 10_000],
    ]);
    expect(signedBalances(await balancesOf(app, a))).toEqual(
      [
        [b.id, 15_000],
        [c.id, 3_000],
      ].sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    );
    await as(c).get(`/balances?groupId=${groupId}`).expect(404);
    await as(a).get('/balances?groupId=nope').expect(400);
  });

  it('keeps the balance when a member leaves or is removed, and after friends are unfriended', async () => {
    const [a, b, c] = await trio();
    const groupId = await createGroup(a, [b, c]);
    await createExpense(app, a, equalExpense(30_000, [a, b, c], { groupId }));
    await createExpense(app, b, equalExpense(10_000, [b, c])); // friend expense between B and C

    await as(c).post(`/groups/${groupId}/leave`).expect(204);
    await as(a).delete(`/groups/${groupId}/members/${b.id}`).expect(204);
    await as(b).delete(`/friends/${c.id}`).expect(204);

    expect(signedBalances(await balancesOf(app, a))).toEqual(
      [
        [b.id, 10_000],
        [c.id, 10_000],
      ].sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    );
    expect(signedBalances(await balancesOf(app, c))).toEqual(
      [
        [a.id, -10_000],
        [b.id, -5_000],
      ].sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    );
  });

  it('is exact after many rounded splits (no drift)', async () => {
    const [a, b, c] = await trio();
    let expectedFromB = 0;
    let expectedFromC = 0;
    for (let i = 0; i < 20; i += 1) {
      const expense = await createExpense(app, a, equalExpense(10_000 + i, [a, b, c]));
      expectedFromB += expense.splits.find((s) => s.user.id === b.id)?.owedMinor ?? 0;
      expectedFromC += expense.splits.find((s) => s.user.id === c.id)?.owedMinor ?? 0;
    }
    const forA = signedBalances(await balancesOf(app, a));
    expect(forA.find(([id]) => id === b.id)?.[1]).toBe(expectedFromB);
    expect(forA.find(([id]) => id === c.id)?.[1]).toBe(expectedFromC);
    // What everyone owes A is A's total outlay minus A's own shares.
    const total = Array.from({ length: 20 }, (_, i) => 10_000 + i).reduce((x, y) => x + y, 0);
    const aShareSum = total - expectedFromB - expectedFromC;
    expect(aShareSum).toBeGreaterThan(0);
  });

  it('a payer who is not a participant is owed the full amount', async () => {
    const [a, b, c] = await trio();
    await createExpense(app, a, equalExpense(90_000, [b, c]));
    expect(signedBalances(await balancesOf(app, a)).map(([, amount]) => amount)).toEqual([
      45_000, 45_000,
    ]);
  });

  describe('pair detail', () => {
    it('rejects your own id, malformed ids, and unrelated users', async () => {
      const [a, b] = await trio();
      await as(a).get(`/balances/users/${a.id}`).expect(400);
      await as(a).get('/balances/users/nope').expect(400);
      await as(a)
        .get(`/balances/users/${'4'.repeat(24)}`)
        .expect(404);
      await as(a).get(`/balances/users/${b.id}`).expect(404); // friends, but no expenses yet
    });
  });

  describe('balance responses', () => {
    it('always returns positive amounts with an explicit direction', async () => {
      const [a, b] = await trio();
      await createExpense(app, b, equalExpense(10_000, [a, b]));
      const body: BalanceBody = await balancesOf(app, a);
      expect(body.balances).toEqual([
        {
          counterparty: expect.objectContaining({ id: b.id }) as unknown,
          currency: 'INR',
          direction: 'YOU_OWE_THEM',
          amountMinor: 5_000,
        },
      ]);
    });
  });
});
