import type { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Types, type Connection } from 'mongoose';
import { client, createTestApp, registerUser, uniqueEmail, type TestUser } from './utils/test-app';

interface FriendRequestBody {
  id: string;
  status: string;
  requester: { id: string };
  addressee: { id: string };
}
interface FriendBody {
  friendshipId: string;
  user: { id: string; name: string; email: string };
}

describe('Friends (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function users(count: number, label: string): Promise<TestUser[]> {
    return Promise.all(Array.from({ length: count }, (_, i) => registerUser(app, `${label}-${i}`)));
  }

  async function sendRequest(from: TestUser, to: TestUser): Promise<FriendRequestBody> {
    const response = await client(app, from)
      .post('/friends/requests', { email: to.email })
      .expect(201);
    return response.body as FriendRequestBody;
  }

  async function friendIds(user: TestUser): Promise<string[]> {
    const response = await client(app, user).get('/friends').expect(200);
    return (response.body as FriendBody[]).map((friend) => friend.user.id);
  }

  async function pendingIds(user: TestUser, direction: 'incoming' | 'outgoing'): Promise<string[]> {
    const response = await client(app, user).get(`/friends/requests/${direction}`).expect(200);
    return (response.body as FriendRequestBody[]).map((request) => request.id);
  }

  async function relationshipCount(a: TestUser, b: TestUser): Promise<number> {
    const [userA, userB] = [a.id, b.id].sort();
    return app
      .get<Connection>(getConnectionToken())
      .collection('friendships')
      .countDocuments({ userA: new Types.ObjectId(userA), userB: new Types.ObjectId(userB) });
  }

  it('sends a request that shows up as outgoing for the sender and incoming for the recipient', async () => {
    const [alice, bob] = await users(2, 'send');
    const request = await sendRequest(alice, bob);

    expect(request).toMatchObject({
      status: 'PENDING',
      requester: { id: alice.id },
      addressee: { id: bob.id, email: bob.email },
    });
    expect(await pendingIds(alice, 'outgoing')).toEqual([request.id]);
    expect(await pendingIds(bob, 'incoming')).toEqual([request.id]);
    expect(await pendingIds(alice, 'incoming')).toEqual([]);
  });

  it('prevents duplicate pending requests', async () => {
    const [alice, bob] = await users(2, 'dup');
    await sendRequest(alice, bob);

    await client(app, alice).post('/friends/requests', { email: bob.email }).expect(409);
    expect(await pendingIds(alice, 'outgoing')).toHaveLength(1);
  });

  it('treats a reverse-direction request as the same relationship', async () => {
    const [alice, bob] = await users(2, 'reverse');
    await sendRequest(alice, bob);

    const response = await client(app, bob)
      .post('/friends/requests', { email: alice.email })
      .expect(409);
    expect((response.body as { message: string }).message).toMatch(/Accept it instead/);
    expect(await relationshipCount(alice, bob)).toBe(1);
  });

  it('prevents concurrent requests in opposite directions from creating two relationships', async () => {
    const [alice, bob] = await users(2, 'race');
    const results = await Promise.all([
      client(app, alice).post('/friends/requests', { email: bob.email }),
      client(app, bob).post('/friends/requests', { email: alice.email }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await relationshipCount(alice, bob)).toBe(1);
  });

  it('prevents sending a request to yourself', async () => {
    const [alice] = await users(1, 'self');
    await client(app, alice).post('/friends/requests', { email: alice.email }).expect(400);
  });

  it('returns 404 for an email with no account and 400 for an invalid email', async () => {
    const [alice] = await users(1, 'unknown');
    await client(app, alice)
      .post('/friends/requests', { email: uniqueEmail('ghost') })
      .expect(404);
    await client(app, alice).post('/friends/requests', { email: 'not-an-email' }).expect(400);
  });

  it('ignores any attempt to choose the sender', async () => {
    const [alice, bob, mallory] = await users(3, 'spoof');
    await client(app, mallory)
      .post('/friends/requests', { email: bob.email, requester: alice.id })
      .expect(400);
  });

  it('lets the recipient accept, making the users friends of each other', async () => {
    const [alice, bob] = await users(2, 'accept');
    const request = await sendRequest(alice, bob);

    const accepted = await client(app, bob)
      .post(`/friends/requests/${request.id}/accept`)
      .expect(200);
    expect(accepted.body).toMatchObject({ status: 'ACCEPTED' });

    expect(await friendIds(alice)).toEqual([bob.id]);
    expect(await friendIds(bob)).toEqual([alice.id]);
    expect(await pendingIds(alice, 'outgoing')).toEqual([]);
    expect(await pendingIds(bob, 'incoming')).toEqual([]);

    await client(app, alice).post('/friends/requests', { email: bob.email }).expect(409);
    await client(app, bob).post(`/friends/requests/${request.id}/accept`).expect(409);
  });

  it('does not let the sender accept or reject their own request', async () => {
    const [alice, bob] = await users(2, 'self-accept');
    const request = await sendRequest(alice, bob);

    await client(app, alice).post(`/friends/requests/${request.id}/accept`).expect(403);
    await client(app, alice).post(`/friends/requests/${request.id}/reject`).expect(403);
    expect(await friendIds(alice)).toEqual([]);
  });

  it('hides a request from users who are not party to it', async () => {
    const [alice, bob, mallory] = await users(3, 'stranger');
    const request = await sendRequest(alice, bob);

    await client(app, mallory).post(`/friends/requests/${request.id}/accept`).expect(404);
    await client(app, mallory).post(`/friends/requests/${request.id}/reject`).expect(404);
    await client(app, mallory).delete(`/friends/requests/${request.id}`).expect(404);
    expect(await pendingIds(bob, 'incoming')).toEqual([request.id]);
  });

  it('lets the recipient reject; only the recipient may later re-open the relationship', async () => {
    const [alice, bob] = await users(2, 'reject');
    const request = await sendRequest(alice, bob);

    const rejected = await client(app, bob)
      .post(`/friends/requests/${request.id}/reject`)
      .expect(200);
    expect(rejected.body).toMatchObject({ status: 'REJECTED' });
    expect(await pendingIds(alice, 'outgoing')).toEqual([]);
    expect(await friendIds(alice)).toEqual([]);

    // The rejected sender cannot re-send…
    await client(app, alice).post('/friends/requests', { email: bob.email }).expect(409);

    // …but the recipient can change their mind, reusing the same relationship.
    const reopened = await sendRequest(bob, alice);
    expect(reopened).toMatchObject({ id: request.id, requester: { id: bob.id } });
    await client(app, alice).post(`/friends/requests/${reopened.id}/accept`).expect(200);
    expect(await friendIds(bob)).toEqual([alice.id]);
    expect(await relationshipCount(alice, bob)).toBe(1);
  });

  it('lets only the sender cancel a pending request', async () => {
    const [alice, bob] = await users(2, 'cancel');
    const request = await sendRequest(alice, bob);

    await client(app, bob).delete(`/friends/requests/${request.id}`).expect(403);
    await client(app, alice).delete(`/friends/requests/${request.id}`).expect(204);
    expect(await pendingIds(bob, 'incoming')).toEqual([]);
    await client(app, alice).delete(`/friends/requests/${request.id}`).expect(404);
  });

  it('lists friends with public profile fields only, sorted by name', async () => {
    const [hub, a, b] = await users(3, 'list');
    for (const other of [b, a]) {
      const request = await sendRequest(other, hub);
      await client(app, hub).post(`/friends/requests/${request.id}/accept`).expect(200);
    }

    const response = await client(app, hub).get('/friends').expect(200);
    const friends = response.body as FriendBody[];
    expect(friends.map((f) => f.user.id)).toEqual([a.id, b.id]);
    for (const friend of friends) {
      expect(Object.keys(friend.user).sort()).toEqual(['email', 'id', 'name']);
    }
  });

  it('removes a friendship for both users', async () => {
    const [alice, bob] = await users(2, 'remove');
    const request = await sendRequest(alice, bob);
    await client(app, bob).post(`/friends/requests/${request.id}/accept`).expect(200);

    await client(app, bob).delete(`/friends/${alice.id}`).expect(204);
    expect(await friendIds(alice)).toEqual([]);
    expect(await friendIds(bob)).toEqual([]);
    await client(app, alice).delete(`/friends/${bob.id}`).expect(404);

    // Either user may start over afterwards.
    await sendRequest(alice, bob);
  });

  it('does not treat a pending request as a friendship to remove', async () => {
    const [alice, bob] = await users(2, 'remove-pending');
    await sendRequest(alice, bob);
    await client(app, alice).delete(`/friends/${bob.id}`).expect(404);
    expect(await pendingIds(bob, 'incoming')).toHaveLength(1);
  });

  it('requires authentication and validates ids', async () => {
    const [alice] = await users(1, 'guard');
    await client(app).get('/friends').expect(401);
    await client(app).post('/friends/requests', { email: alice.email }).expect(401);
    await client(app, alice).post('/friends/requests/not-an-id/accept').expect(400);
    await client(app, alice).delete('/friends/123').expect(400);
  });
});
