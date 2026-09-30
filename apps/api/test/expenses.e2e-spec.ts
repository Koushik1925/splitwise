import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import request from 'supertest';
import { Expense } from '../src/expenses/schemas/expense.schema';
import {
  API,
  client,
  createTestApp,
  makeFriends,
  registerUser,
  type TestUser,
} from './utils/test-app';
import {
  createExpense,
  equalExpense,
  newKey,
  postExpense,
  type ExpenseBody,
} from './utils/expenses';

interface ListBody {
  items: ExpenseBody[];
  nextCursor: string | null;
}

describe('Expenses (e2e)', () => {
  let app: INestApplication;
  // alice is friends with bob and carol; bob and carol are friends with each other. dave is a stranger.
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let dave: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
    [alice, bob, carol, dave] = await Promise.all(
      ['alice', 'bob', 'carol', 'dave'].map((label) => registerUser(app, `exp-${label}`)),
    );
    await makeFriends(app, alice, bob);
    await makeFriends(app, alice, carol);
    await makeFriends(app, bob, carol);
  });

  afterAll(async () => {
    await app.close();
  });

  const as = (user?: TestUser) => client(app, user);

  async function createGroup(owner: TestUser, members: TestUser[]): Promise<string> {
    const group = await as(owner).post('/groups', { name: 'Trip' }).expect(201);
    const groupId = (group.body as { id: string }).id;
    for (const member of members) {
      await as(owner).post(`/groups/${groupId}/members`, { userId: member.id }).expect(201);
    }
    return groupId;
  }

  const owedBy = (expense: ExpenseBody) =>
    Object.fromEntries(expense.splits.map((split) => [split.user.id, split.owedMinor]));

  describe('creating expenses', () => {
    it('creates an equal split: A pays ₹900 for A, B and C', async () => {
      const expense = await createExpense(app, alice, equalExpense(90_000, [alice, bob, carol]));

      expect(expense).toMatchObject({
        description: 'Dinner',
        amountMinor: 90_000,
        currency: 'INR',
        splitMethod: 'EQUAL',
        group: null,
        paidBy: { id: alice.id },
        createdBy: { id: alice.id },
        yourShareMinor: 30_000,
        yourNetMinor: 60_000,
      });
      expect(owedBy(expense)).toEqual({ [alice.id]: 30_000, [bob.id]: 30_000, [carol.id]: 30_000 });
      expect(expense.splits.every((split) => split.input === null)).toBe(true);
    });

    it('creates an exact split and records the supplied amounts', async () => {
      const expense = await createExpense(app, alice, {
        description: 'Groceries',
        amountMinor: 90_000,
        currency: 'INR',
        splitMethod: 'EXACT',
        participants: [
          { userId: alice.id, amountMinor: 10_000 },
          { userId: bob.id, amountMinor: 50_000 },
          { userId: carol.id, amountMinor: 30_000 },
        ],
      });
      expect(owedBy(expense)).toEqual({ [alice.id]: 10_000, [bob.id]: 50_000, [carol.id]: 30_000 });
      expect(expense.splits.find((split) => split.user.id === bob.id)?.input).toBe(50_000);
    });

    it('creates a percentage split (50 / 30 / 20 %)', async () => {
      const expense = await createExpense(app, alice, {
        description: 'Rent',
        amountMinor: 100_000,
        currency: 'INR',
        splitMethod: 'PERCENTAGE',
        participants: [
          { userId: alice.id, percentageBps: 5000 },
          { userId: bob.id, percentageBps: 3000 },
          { userId: carol.id, percentageBps: 2000 },
        ],
      });
      expect(owedBy(expense)).toEqual({ [alice.id]: 50_000, [bob.id]: 30_000, [carol.id]: 20_000 });
    });

    it('creates a shares split (1 : 2 : 3)', async () => {
      const expense = await createExpense(app, alice, {
        description: 'Taxi',
        amountMinor: 60_000,
        currency: 'INR',
        splitMethod: 'SHARES',
        participants: [
          { userId: alice.id, shares: 1 },
          { userId: bob.id, shares: 2 },
          { userId: carol.id, shares: 3 },
        ],
      });
      expect(owedBy(expense)).toEqual({ [alice.id]: 10_000, [bob.id]: 20_000, [carol.id]: 30_000 });
    });

    it('rounds ₹100.00 three ways deterministically and reconciles exactly', async () => {
      const expense = await createExpense(app, alice, equalExpense(10_000, [alice, bob, carol]));
      const owed = Object.values(owedBy(expense)).sort();
      expect(owed).toEqual([3333, 3333, 3334]);
      expect(owed.reduce((a, b) => a + b, 0)).toBe(10_000);
      // The extra paisa goes to the participant with the lowest user id.
      const lowest = [alice.id, bob.id, carol.id].sort()[0];
      expect(owedBy(expense)[lowest]).toBe(3334);
    });

    it('gives a single paisa to exactly one of two participants, the lowest user id', async () => {
      const expense = await createExpense(app, alice, equalExpense(1, [bob, carol]));
      const lowest = [bob.id, carol.id].sort()[0];
      expect(owedBy(expense)[lowest]).toBe(1);
      expect(Object.values(owedBy(expense)).reduce((a, b) => a + b, 0)).toBe(1);
    });

    it('rejects a split that leaves nobody but the payer owing (1 paisa lands on the payer)', async () => {
      // With one paisa and equal weights, the whole paisa goes to the lowest id; make that the payer.
      const [payer, other] = [alice, bob].sort((x, y) => x.id.localeCompare(y.id));
      await postExpense(app, payer, equalExpense(1, [payer, other])).expect(400);
    });

    it('lets the payer sit out: A pays ₹900 entirely for B and C', async () => {
      const expense = await createExpense(app, alice, equalExpense(90_000, [bob, carol]));
      expect(owedBy(expense)).toEqual({ [bob.id]: 45_000, [carol.id]: 45_000 });
      expect(expense).toMatchObject({ yourShareMinor: 0, yourNetMinor: 90_000 });
    });

    it('lets a debtor record an expense someone else paid', async () => {
      const expense = await createExpense(
        app,
        alice,
        equalExpense(20_000, [alice, bob], { paidBy: bob.id }),
      );
      expect(expense).toMatchObject({
        paidBy: { id: bob.id },
        createdBy: { id: alice.id },
        yourShareMinor: 10_000,
        yourNetMinor: -10_000,
      });
    });

    it('trims the description', async () => {
      const expense = await createExpense(
        app,
        alice,
        equalExpense(1000, [alice, bob], { description: '  Coffee  ' }),
      );
      expect(expense.description).toBe('Coffee');
    });
  });

  describe('authentication and route surface', () => {
    it('requires authentication on every route', async () => {
      const id = '0'.repeat(24);
      await postExpense(app, undefined, equalExpense(100, [alice, bob])).expect(401);
      await as().get('/expenses').expect(401);
      await as().get(`/expenses/${id}`).expect(401);
      await as().get('/balances').expect(401);
      await as().get(`/balances/users/${id}`).expect(401);
    });

    it('has no way to edit or delete an expense, or to write a balance', async () => {
      const expense = await createExpense(app, alice, equalExpense(1000, [alice, bob]));
      await as(alice).patch(`/expenses/${expense.id}`, { amountMinor: 1 }).expect(404);
      await as(alice).delete(`/expenses/${expense.id}`).expect(404);
      await request(app.getHttpServer())
        .put(`${API}/expenses/${expense.id}`)
        .set('Cookie', alice.cookie)
        .send({})
        .expect(404);
      await as(alice).post('/balances', { amountMinor: 1 }).expect(404);
      await as(alice).patch('/balances', { amountMinor: 1 }).expect(404);
      const unchanged = await as(alice).get(`/expenses/${expense.id}`).expect(200);
      expect((unchanged.body as ExpenseBody).amountMinor).toBe(1000);
    });
  });

  describe('input validation', () => {
    it.each([
      ['zero', 0],
      ['negative', -100],
      ['fractional', 100.5],
      ['above the maximum', 10_000_000_001],
      ['a string', '1000'],
      ['null', null],
    ])('rejects an amount that is %s', async (_label, amountMinor) => {
      await postExpense(app, alice, equalExpense(1, [alice, bob], { amountMinor })).expect(400);
    });

    it('accepts the maximum amount', async () => {
      const expense = await createExpense(app, alice, equalExpense(10_000_000_000, [alice, bob]));
      expect(expense.amountMinor).toBe(10_000_000_000);
    });

    it.each(['USD', 'inr', '', 5])('rejects currency %p', async (currency) => {
      await postExpense(app, alice, equalExpense(1000, [alice, bob], { currency })).expect(400);
    });

    it('rejects a missing or empty description', async () => {
      await postExpense(
        app,
        alice,
        equalExpense(1000, [alice, bob], { description: '   ' }),
      ).expect(400);
      const { description: _omitted, ...withoutDescription } = equalExpense(1000, [alice, bob]);
      await postExpense(app, alice, withoutDescription).expect(400);
    });

    it('rejects an over-long description', async () => {
      await postExpense(
        app,
        alice,
        equalExpense(1000, [alice, bob], { description: 'x'.repeat(201) }),
      ).expect(400);
    });

    it('rejects an unknown split method and an empty participant list', async () => {
      await postExpense(
        app,
        alice,
        equalExpense(1000, [alice, bob], { splitMethod: 'HALF' }),
      ).expect(400);
      await postExpense(app, alice, equalExpense(1000, [])).expect(400);
    });

    it('rejects malformed participant ids', async () => {
      await postExpense(app, alice, {
        ...equalExpense(1000, [alice]),
        participants: [{ userId: alice.id }, { userId: 'not-an-id' }],
      }).expect(400);
    });

    it('rejects duplicate participants, including differently cased ids', async () => {
      await postExpense(app, alice, equalExpense(1000, [alice, bob, bob])).expect(400);
      await postExpense(app, alice, {
        ...equalExpense(1000, [alice]),
        participants: [{ userId: alice.id }, { userId: bob.id }, { userId: bob.id.toUpperCase() }],
      }).expect(400);
    });

    it('rejects exact amounts that do not add up to the total', async () => {
      const body = (amounts: number[]) => ({
        description: 'x',
        amountMinor: 10_000,
        currency: 'INR',
        splitMethod: 'EXACT',
        participants: [
          { userId: alice.id, amountMinor: amounts[0] },
          { userId: bob.id, amountMinor: amounts[1] },
        ],
      });
      await postExpense(app, alice, body([5000, 4999])).expect(400);
      await postExpense(app, alice, body([5000, 5001])).expect(400);
      await postExpense(app, alice, body([10_000, 0])).expect(400);
      await postExpense(app, alice, body([5000, 5000])).expect(201);
    });

    it('rejects percentages that do not total 100%', async () => {
      const body = (bps: number[]) => ({
        description: 'x',
        amountMinor: 10_000,
        currency: 'INR',
        splitMethod: 'PERCENTAGE',
        participants: [
          { userId: alice.id, percentageBps: bps[0] },
          { userId: bob.id, percentageBps: bps[1] },
        ],
      });
      await postExpense(app, alice, body([5000, 4999])).expect(400);
      await postExpense(app, alice, body([5000, 5001])).expect(400);
      await postExpense(app, alice, body([10_000, 0])).expect(400);
      await postExpense(app, alice, body([5000, 5000])).expect(201);
    });

    it('rejects zero, negative and fractional share counts', async () => {
      const body = (shares: number[]) => ({
        description: 'x',
        amountMinor: 10_000,
        currency: 'INR',
        splitMethod: 'SHARES',
        participants: [
          { userId: alice.id, shares: shares[0] },
          { userId: bob.id, shares: shares[1] },
        ],
      });
      await postExpense(app, alice, body([1, 0])).expect(400);
      await postExpense(app, alice, body([1, -2])).expect(400);
      await postExpense(app, alice, body([1, 1.5])).expect(400);
    });

    it('rejects fields that do not belong to the chosen split method', async () => {
      await postExpense(app, alice, {
        ...equalExpense(1000, [alice]),
        participants: [
          { userId: alice.id, shares: 1 },
          { userId: bob.id, shares: 1 },
        ],
      }).expect(400);
      await postExpense(app, alice, {
        description: 'x',
        amountMinor: 1000,
        currency: 'INR',
        splitMethod: 'SHARES',
        participants: [
          { userId: alice.id, amountMinor: 500 },
          { userId: bob.id, amountMinor: 500 },
        ],
      }).expect(400);
    });

    it('rejects an expense where nobody but the payer owes anything', async () => {
      await postExpense(app, alice, equalExpense(1000, [alice])).expect(400);
    });

    it.each([
      ['createdBy', { createdBy: '5'.repeat(24) }],
      ['splits', { splits: [{ user: '5'.repeat(24), owedMinor: 1 }] }],
      ['owedMinor', { owedMinor: 1 }],
      ['balance', { balance: 0 }],
      ['status', { status: 'SETTLED' }],
      ['idempotencyKey', { idempotencyKey: 'abcdefgh' }],
    ])('rejects the server-owned field %s', async (_field, extra) => {
      await postExpense(app, alice, equalExpense(1000, [alice, bob], extra)).expect(400);
    });

    it('rejects a participant carrying an owed amount', async () => {
      await postExpense(app, alice, {
        ...equalExpense(1000, [alice]),
        participants: [{ userId: alice.id }, { userId: bob.id, owedMinor: 1000 }],
      }).expect(400);
    });
  });

  describe('authorization', () => {
    it('ignores no client-supplied identity: the creator is always the caller', async () => {
      const expense = await createExpense(app, bob, equalExpense(1000, [alice, bob]));
      expect(expense.createdBy.id).toBe(bob.id);
    });

    it('rejects participants who are not friends of the payer', async () => {
      await postExpense(app, alice, equalExpense(1000, [alice, dave])).expect(403);
    });

    it('answers the same for an unknown user id, so ids cannot be probed', async () => {
      const unknown = await postExpense(app, alice, {
        ...equalExpense(1000, [alice]),
        participants: [{ userId: alice.id }, { userId: '1'.repeat(24) }],
      }).expect(403);
      const stranger = await postExpense(app, alice, equalExpense(1000, [alice, dave])).expect(403);
      expect((unknown.body as { message: string }).message).toBe(
        (stranger.body as { message: string }).message,
      );
    });

    it('rejects a payer who is not a friend of the debtors', async () => {
      await postExpense(app, alice, equalExpense(1000, [alice, bob], { paidBy: dave.id })).expect(
        403,
      );
    });

    it('rejects an expense the creator neither paid for nor owes a share of', async () => {
      // carol paid, bob owes: alice is only a bystander.
      await postExpense(app, alice, equalExpense(1000, [bob], { paidBy: carol.id })).expect(403);
    });

    it('requires each debtor to be a friend of the payer even when the creator is friends with all', async () => {
      const outsider = await registerUser(app, 'exp-outsider');
      await makeFriends(app, alice, outsider);
      // bob and outsider are both alice's friends but not friends with each other; bob pays, outsider owes.
      await postExpense(
        app,
        alice,
        equalExpense(1000, [alice, outsider], { paidBy: bob.id }),
      ).expect(403);
    });

    it('does not let the payer be silently substituted on a replay', async () => {
      const key = newKey();
      await postExpense(app, alice, equalExpense(1000, [alice, bob]), key).expect(201);
      await postExpense(
        app,
        alice,
        equalExpense(1000, [alice, bob], { paidBy: bob.id }),
        key,
      ).expect(409);
    });
  });

  describe('group expenses', () => {
    it('lets any active member (including a plain MEMBER) record a group expense', async () => {
      const groupId = await createGroup(alice, [bob, carol]);

      const byOwner = await createExpense(
        app,
        alice,
        equalExpense(30_000, [alice, bob, carol], { groupId }),
      );
      expect(byOwner.group).toMatchObject({ id: groupId, name: 'Trip' });

      const byMember = await createExpense(
        app,
        bob,
        equalExpense(30_000, [alice, bob, carol], { groupId }),
      );
      expect(byMember.createdBy.id).toBe(bob.id);
    });

    it('treats a non-member as if the group does not exist', async () => {
      const groupId = await createGroup(alice, [bob]);
      await postExpense(app, dave, equalExpense(1000, [dave, alice], { groupId })).expect(404);
      await postExpense(
        app,
        alice,
        equalExpense(1000, [alice, bob], { groupId: '2'.repeat(24) }),
      ).expect(404);
    });

    it('rejects payers and participants who are not active members, even if they are friends', async () => {
      const groupId = await createGroup(alice, [bob]);
      // carol is alice's friend but not in the group.
      await postExpense(app, alice, equalExpense(1000, [alice, carol], { groupId })).expect(403);
      await postExpense(
        app,
        alice,
        equalExpense(1000, [alice, bob], { groupId, paidBy: carol.id }),
      ).expect(403);
    });

    it('allows group members who are not friends with each other', async () => {
      const groupId = await createGroup(alice, [bob, carol]);
      const outsider = await registerUser(app, 'exp-grp-nofriend');
      await makeFriends(app, alice, outsider);
      await as(alice).post(`/groups/${groupId}/members`, { userId: outsider.id }).expect(201);
      // bob and outsider are not friends, but both are group members.
      const expense = await createExpense(
        app,
        bob,
        equalExpense(1000, [bob, outsider], { groupId }),
      );
      expect(expense.group?.id).toBe(groupId);
    });

    it('rejects users who left or were removed from the group', async () => {
      const groupId = await createGroup(alice, [bob, carol]);
      await as(carol).post(`/groups/${groupId}/leave`).expect(204);
      await as(alice).delete(`/groups/${groupId}/members/${bob.id}`).expect(204);

      await postExpense(app, alice, equalExpense(1000, [alice, carol], { groupId })).expect(403);
      await postExpense(app, alice, equalExpense(1000, [alice, bob], { groupId })).expect(403);
      await postExpense(app, carol, equalExpense(1000, [carol, alice], { groupId })).expect(404);
    });
  });

  describe('reading expenses', () => {
    it('shows an expense to its payer and participants, and hides it from strangers', async () => {
      const expense = await createExpense(app, alice, equalExpense(60_000, [bob, carol]));

      const forPayer = await as(alice).get(`/expenses/${expense.id}`).expect(200);
      expect(forPayer.body).toMatchObject({
        id: expense.id,
        yourShareMinor: 0,
        yourNetMinor: 60_000,
      });

      const forParticipant = await as(bob).get(`/expenses/${expense.id}`).expect(200);
      expect(forParticipant.body).toMatchObject({
        id: expense.id,
        yourShareMinor: 30_000,
        yourNetMinor: -30_000,
      });

      await as(dave).get(`/expenses/${expense.id}`).expect(404);
      await as(dave)
        .get(`/expenses/${'3'.repeat(24)}`)
        .expect(404);
      await as(alice).get('/expenses/not-an-id').expect(400);
    });

    it("never exposes a caller's expenses to other users' lists", async () => {
      const loner = await registerUser(app, 'exp-loner');
      const list = await as(loner).get('/expenses').expect(200);
      expect(list.body).toEqual({ items: [], nextCursor: null });
    });

    it('lets active group members see all group expenses, including ones they are not in', async () => {
      const groupId = await createGroup(alice, [bob, carol]);
      const expense = await createExpense(
        app,
        alice,
        equalExpense(1000, [alice, bob], { groupId }),
      );

      // carol is neither payer nor participant, but is an active member.
      await as(carol).get(`/expenses/${expense.id}`).expect(200);
      const groupList = await as(carol).get(`/expenses?groupId=${groupId}`).expect(200);
      expect((groupList.body as ListBody).items.map((item) => item.id)).toEqual([expense.id]);

      await as(dave).get(`/expenses?groupId=${groupId}`).expect(404);
      await as(dave).get(`/expenses/${expense.id}`).expect(404);
    });

    it('lists newest first and paginates with a cursor', async () => {
      const groupId = await createGroup(alice, [bob]);
      const created: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        const expense = await createExpense(
          app,
          alice,
          equalExpense(1000 + i, [alice, bob], { groupId, description: `Item ${i}` }),
        );
        created.push(expense.id);
      }
      const newestFirst = [...created].reverse();

      const first = await as(alice).get(`/expenses?groupId=${groupId}&limit=2`).expect(200);
      const firstBody = first.body as ListBody;
      expect(firstBody.items.map((item) => item.id)).toEqual(newestFirst.slice(0, 2));
      expect(firstBody.nextCursor).toBe(newestFirst[1]);

      const second = await as(alice)
        .get(`/expenses?groupId=${groupId}&limit=2&cursor=${firstBody.nextCursor}`)
        .expect(200);
      const secondBody = second.body as ListBody;
      expect(secondBody.items.map((item) => item.id)).toEqual(newestFirst.slice(2, 4));

      const third = await as(alice)
        .get(`/expenses?groupId=${groupId}&limit=2&cursor=${secondBody.nextCursor}`)
        .expect(200);
      const thirdBody = third.body as ListBody;
      expect(thirdBody.items.map((item) => item.id)).toEqual(newestFirst.slice(4));
      expect(thirdBody.nextCursor).toBeNull();
    });

    it('rejects invalid list parameters', async () => {
      await as(alice).get('/expenses?limit=0').expect(400);
      await as(alice).get('/expenses?limit=101').expect(400);
      await as(alice).get('/expenses?limit=abc').expect(400);
      await as(alice).get('/expenses?cursor=nope').expect(400);
      await as(alice).get('/expenses?groupId=nope').expect(400);
    });
  });

  describe('history after membership changes', () => {
    it('keeps group expenses valid and visible to the parties after someone leaves', async () => {
      const groupId = await createGroup(alice, [bob, carol]);
      const expense = await createExpense(
        app,
        alice,
        equalExpense(30_000, [alice, bob, carol], { groupId }),
      );

      await as(carol).post(`/groups/${groupId}/leave`).expect(204);
      await as(alice).delete(`/groups/${groupId}/members/${bob.id}`).expect(204);

      // Both former members remain parties to the expense and can still read it.
      const carolView = await as(carol).get(`/expenses/${expense.id}`).expect(200);
      expect((carolView.body as ExpenseBody).yourShareMinor).toBe(10_000);
      await as(bob).get(`/expenses/${expense.id}`).expect(200);
      // ...and it still appears in their personal list, but not through the group.
      const carolList = await as(carol).get('/expenses').expect(200);
      expect((carolList.body as ListBody).items.map((item) => item.id)).toContain(expense.id);
      await as(carol).get(`/expenses?groupId=${groupId}`).expect(404);
      // The expense itself is unchanged.
      const ownerView = await as(alice).get(`/expenses/${expense.id}`).expect(200);
      expect((ownerView.body as ExpenseBody).splits).toHaveLength(3);
    });

    it('keeps friend expenses after the friendship is removed', async () => {
      const x = await registerUser(app, 'exp-unfriend-x');
      const y = await registerUser(app, 'exp-unfriend-y');
      await makeFriends(app, x, y);
      const expense = await createExpense(app, x, equalExpense(10_000, [x, y]));

      await as(x).delete(`/friends/${y.id}`).expect(204);

      await as(y).get(`/expenses/${expense.id}`).expect(200);
      await postExpense(app, x, equalExpense(10_000, [x, y])).expect(403);
    });
  });

  describe('idempotency', () => {
    it('requires an Idempotency-Key', async () => {
      await postExpense(app, alice, equalExpense(1000, [alice, bob]), null).expect(400);
      await postExpense(app, alice, equalExpense(1000, [alice, bob]), '').expect(400);
      await postExpense(app, alice, equalExpense(1000, [alice, bob]), 'short').expect(400);
      await postExpense(app, alice, equalExpense(1000, [alice, bob]), 'has spaces in it').expect(
        400,
      );
    });

    it('returns the original expense, without creating another, for an identical retry', async () => {
      const key = newKey();
      const body = equalExpense(45_000, [alice, bob, carol], { description: 'Retry me' });

      const first = await postExpense(app, alice, body, key).expect(201);
      const second = await postExpense(app, alice, body, key).expect(200);

      expect((second.body as ExpenseBody).id).toBe((first.body as ExpenseBody).id);
      expect(second.body).toEqual(first.body);

      const list = await as(alice).get('/expenses?limit=100').expect(200);
      const matches = (list.body as ListBody).items.filter(
        (item) => item.description === 'Retry me',
      );
      expect(matches).toHaveLength(1);
    });

    it('treats a retry with reordered participants and differently cased ids as identical', async () => {
      const key = newKey();
      const first = await postExpense(
        app,
        alice,
        equalExpense(9000, [alice, bob, carol]),
        key,
      ).expect(201);
      const retry = await postExpense(
        app,
        alice,
        {
          ...equalExpense(9000, []),
          participants: [
            { userId: carol.id.toUpperCase() },
            { userId: alice.id },
            { userId: bob.id },
          ],
        },
        key,
      ).expect(200);
      expect((retry.body as ExpenseBody).id).toBe((first.body as ExpenseBody).id);
    });

    it('returns 409 when the key is reused with a different body', async () => {
      const key = newKey();
      await postExpense(app, alice, equalExpense(1000, [alice, bob]), key).expect(201);
      await postExpense(app, alice, equalExpense(1001, [alice, bob]), key).expect(409);
      await postExpense(
        app,
        alice,
        equalExpense(1000, [alice, bob], { description: 'Different' }),
        key,
      ).expect(409);
    });

    it('scopes keys per creator: the same key from another user is a separate expense', async () => {
      const key = newKey();
      const a = await postExpense(app, alice, equalExpense(1000, [alice, bob]), key).expect(201);
      const b = await postExpense(app, bob, equalExpense(1000, [alice, bob]), key).expect(201);
      expect((a.body as ExpenseBody).id).not.toBe((b.body as ExpenseBody).id);
    });

    it('creates exactly one expense when identical requests arrive concurrently', async () => {
      const key = newKey();
      const body = equalExpense(77_700, [alice, bob, carol], { description: 'Concurrent dinner' });

      const responses = await Promise.all(
        Array.from({ length: 12 }, () => postExpense(app, alice, body, key)),
      );

      expect(responses.every((response) => [200, 201].includes(response.status))).toBe(true);
      expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
      const ids = new Set(responses.map((response) => (response.body as ExpenseBody).id));
      expect(ids.size).toBe(1);

      const stored = await app
        .get<Model<Expense>>(getModelToken(Expense.name))
        .countDocuments({ createdBy: alice.id, idempotencyKey: key })
        .exec();
      expect(stored).toBe(1);
    });

    it('still rejects conflicting concurrent requests that share a key with a 409', async () => {
      const key = newKey();
      const responses = await Promise.all([
        postExpense(app, alice, equalExpense(1000, [alice, bob], { description: 'race A' }), key),
        postExpense(app, alice, equalExpense(2000, [alice, bob], { description: 'race B' }), key),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    });

    it('does not create an expense when the request is rejected', async () => {
      const key = newKey();
      await postExpense(
        app,
        alice,
        equalExpense(1000, [alice, dave], { description: 'Rejected' }),
        key,
      ).expect(403);
      // The same key is still free to use for a valid request.
      await postExpense(
        app,
        alice,
        equalExpense(1000, [alice, bob], { description: 'Accepted' }),
        key,
      ).expect(201);
    });
  });
});
