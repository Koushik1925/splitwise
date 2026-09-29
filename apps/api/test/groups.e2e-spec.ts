import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import {
  GroupMember,
  GroupMemberStatus,
  GroupRole,
} from '../src/groups/schemas/group-member.schema';
import { client, createTestApp, makeFriends, registerUser, type TestUser } from './utils/test-app';

interface MemberBody {
  user: { id: string; name: string; email: string };
  role: string;
  joinedAt: string;
}
interface GroupBody {
  id: string;
  name: string;
  description: string;
  role: string;
  members: MemberBody[];
}

describe('Groups (e2e)', () => {
  let app: INestApplication;
  // owner is friends with admin, member and candidate; admin is also friends with adminFriend.
  let owner: TestUser;
  let admin: TestUser;
  let member: TestUser;
  let candidate: TestUser;
  let adminFriend: TestUser;
  let outsider: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
    [owner, admin, member, candidate, adminFriend, outsider] = await Promise.all(
      ['owner', 'admin', 'member', 'candidate', 'admin-friend', 'outsider'].map((label) =>
        registerUser(app, `group-${label}`),
      ),
    );
    await makeFriends(app, owner, admin);
    await makeFriends(app, owner, member);
    await makeFriends(app, owner, candidate);
    await makeFriends(app, admin, adminFriend);
  });

  afterAll(async () => {
    await app.close();
  });

  const as = (user?: TestUser) => client(app, user);

  async function createGroup(name = 'Goa trip'): Promise<GroupBody> {
    const response = await as(owner)
      .post('/groups', { name, description: 'Shared costs' })
      .expect(201);
    return response.body as GroupBody;
  }

  /** Group with owner (OWNER), admin (ADMIN) and member (MEMBER). */
  async function createStaffedGroup(): Promise<string> {
    const group = await createGroup();
    await as(owner).post(`/groups/${group.id}/members`, { userId: admin.id }).expect(201);
    await as(owner).patch(`/groups/${group.id}/members/${admin.id}`, { role: 'ADMIN' }).expect(200);
    await as(owner).post(`/groups/${group.id}/members`, { userId: member.id }).expect(201);
    return group.id;
  }

  async function membersOf(groupId: string): Promise<Array<[string, string]>> {
    const response = await as(owner).get(`/groups/${groupId}`).expect(200);
    return (response.body as GroupBody).members.map((m) => [m.user.id, m.role]);
  }

  describe('creating and reading', () => {
    it('creates a group whose creator is its OWNER and only member', async () => {
      const group = await createGroup('Flat 4B');

      expect(group).toMatchObject({ name: 'Flat 4B', description: 'Shared costs', role: 'OWNER' });
      expect(group.members).toEqual([
        {
          user: { id: owner.id, name: owner.name, email: owner.email },
          role: 'OWNER',
          joinedAt: expect.any(String),
        },
      ]);
    });

    it('rejects client-supplied ownership or membership fields', async () => {
      await as(owner).post('/groups', { name: 'X', ownerId: outsider.id }).expect(400);
      await as(owner)
        .post('/groups', { name: 'X', members: [outsider.id] })
        .expect(400);
      await as(owner).post('/groups', { name: '   ' }).expect(400);
    });

    it("lists only the caller's groups, with the caller's role", async () => {
      const groupId = await createStaffedGroup();

      const ownerGroups = (await as(owner).get('/groups').expect(200)).body as GroupBody[];
      const memberGroups = (await as(member).get('/groups').expect(200)).body as GroupBody[];
      const outsiderGroups = (await as(outsider).get('/groups').expect(200)).body as GroupBody[];

      expect(ownerGroups.find((g) => g.id === groupId)?.role).toBe('OWNER');
      expect(memberGroups.find((g) => g.id === groupId)?.role).toBe('MEMBER');
      expect(outsiderGroups.some((g) => g.id === groupId)).toBe(false);
    });

    it('lets every active member read the group, and hides it from non-members with 404', async () => {
      const groupId = await createStaffedGroup();

      for (const user of [owner, admin, member]) {
        await as(user).get(`/groups/${groupId}`).expect(200);
      }
      await as(outsider).get(`/groups/${groupId}`).expect(404);
      // Indistinguishable from a group that does not exist.
      await as(outsider).get(`/groups/${new Types.ObjectId().toHexString()}`).expect(404);
      expect(await membersOf(groupId)).toEqual([
        [owner.id, 'OWNER'],
        [admin.id, 'ADMIN'],
        [member.id, 'MEMBER'],
      ]);
    });

    it('requires authentication', async () => {
      await as().get('/groups').expect(401);
      await as().post('/groups', { name: 'X' }).expect(401);
    });
  });

  describe('adding members', () => {
    it("adds the owner's friend as a MEMBER", async () => {
      const group = await createGroup();
      const response = await as(owner)
        .post(`/groups/${group.id}/members`, { userId: candidate.id })
        .expect(201);

      expect(response.body).toMatchObject({ user: { id: candidate.id }, role: 'MEMBER' });
      await as(candidate).get(`/groups/${group.id}`).expect(200);
    });

    it('prevents duplicate membership', async () => {
      const groupId = await createStaffedGroup();
      await as(owner).post(`/groups/${groupId}/members`, { userId: member.id }).expect(409);
      await as(owner).post(`/groups/${groupId}/members`, { userId: owner.id }).expect(409);
      expect(await membersOf(groupId)).toHaveLength(3);
    });

    it('only allows adding users who are friends of the caller', async () => {
      const groupId = await createStaffedGroup();
      await as(owner).post(`/groups/${groupId}/members`, { userId: outsider.id }).expect(403);
      await as(owner).post(`/groups/${groupId}/members`, { userId: adminFriend.id }).expect(403);
      // Unknown ids get the same answer, revealing nothing about which accounts exist.
      await as(owner)
        .post(`/groups/${groupId}/members`, { userId: new Types.ObjectId().toHexString() })
        .expect(403);
    });

    it('lets an admin add their own friends', async () => {
      const groupId = await createStaffedGroup();
      await as(admin).post(`/groups/${groupId}/members`, { userId: adminFriend.id }).expect(201);
      await as(adminFriend).get(`/groups/${groupId}`).expect(200);
    });

    it('does not let a MEMBER add members', async () => {
      const groupId = await createStaffedGroup();
      await as(member).post(`/groups/${groupId}/members`, { userId: owner.id }).expect(403);
    });

    it('does not let non-members add members (404)', async () => {
      const groupId = await createStaffedGroup();
      await as(outsider).post(`/groups/${groupId}/members`, { userId: member.id }).expect(404);
    });

    it('validates the user id and rejects role escalation on add', async () => {
      const groupId = await createStaffedGroup();
      await as(owner).post(`/groups/${groupId}/members`, { userId: 'nope' }).expect(400);
      await as(owner)
        .post(`/groups/${groupId}/members`, { userId: candidate.id, role: 'OWNER' })
        .expect(400);
    });
  });

  describe('roles', () => {
    it('lets only the owner change roles, and never to OWNER', async () => {
      const groupId = await createStaffedGroup();

      await as(admin)
        .patch(`/groups/${groupId}/members/${member.id}`, { role: 'ADMIN' })
        .expect(403);
      await as(member)
        .patch(`/groups/${groupId}/members/${admin.id}`, { role: 'MEMBER' })
        .expect(403);
      await as(owner)
        .patch(`/groups/${groupId}/members/${member.id}`, { role: 'OWNER' })
        .expect(400);
      await as(owner)
        .patch(`/groups/${groupId}/members/${owner.id}`, { role: 'MEMBER' })
        .expect(403);

      await as(owner)
        .patch(`/groups/${groupId}/members/${admin.id}`, { role: 'MEMBER' })
        .expect(200);
      expect(await membersOf(groupId)).toContainEqual([admin.id, 'MEMBER']);
    });
  });

  describe('removing members', () => {
    it('lets the owner remove admins and members', async () => {
      const groupId = await createStaffedGroup();
      await as(owner).delete(`/groups/${groupId}/members/${admin.id}`).expect(204);
      await as(owner).delete(`/groups/${groupId}/members/${member.id}`).expect(204);

      expect(await membersOf(groupId)).toEqual([[owner.id, 'OWNER']]);
      await as(member).get(`/groups/${groupId}`).expect(404);
    });

    it('lets an admin remove a MEMBER but not the owner', async () => {
      const groupId = await createStaffedGroup();
      await as(admin).delete(`/groups/${groupId}/members/${owner.id}`).expect(403);
      await as(admin).delete(`/groups/${groupId}/members/${member.id}`).expect(204);
    });

    it('does not let an admin remove another admin', async () => {
      const groupId = await createStaffedGroup();
      await as(owner)
        .patch(`/groups/${groupId}/members/${member.id}`, { role: 'ADMIN' })
        .expect(200);
      await as(admin).delete(`/groups/${groupId}/members/${member.id}`).expect(403);
    });

    it('does not let a MEMBER remove anyone', async () => {
      const groupId = await createStaffedGroup();
      await as(member).delete(`/groups/${groupId}/members/${admin.id}`).expect(403);
      await as(member).delete(`/groups/${groupId}/members/${owner.id}`).expect(403);
      expect(await membersOf(groupId)).toHaveLength(3);
    });

    it('never removes the owner, including via self-removal', async () => {
      const groupId = await createStaffedGroup();
      await as(owner).delete(`/groups/${groupId}/members/${owner.id}`).expect(400);
      expect(await membersOf(groupId)).toContainEqual([owner.id, 'OWNER']);
    });

    it('does not let non-members remove anyone (404)', async () => {
      const groupId = await createStaffedGroup();
      await as(outsider).delete(`/groups/${groupId}/members/${member.id}`).expect(404);
    });

    it('re-activates a removed member when they are added again', async () => {
      const groupId = await createStaffedGroup();
      await as(owner).delete(`/groups/${groupId}/members/${member.id}`).expect(204);
      await as(owner).post(`/groups/${groupId}/members`, { userId: member.id }).expect(201);

      await as(member).get(`/groups/${groupId}`).expect(200);
      const rows = await app
        .get<Model<GroupMember>>(getModelToken(GroupMember.name))
        .countDocuments({
          group: new Types.ObjectId(groupId),
          user: new Types.ObjectId(member.id),
        });
      expect(rows).toBe(1);
    });
  });

  describe('leaving', () => {
    it('lets a member leave, after which they lose access', async () => {
      const groupId = await createStaffedGroup();
      await as(member).post(`/groups/${groupId}/leave`).expect(204);

      await as(member).get(`/groups/${groupId}`).expect(404);
      const groups = (await as(member).get('/groups').expect(200)).body as GroupBody[];
      expect(groups.some((g) => g.id === groupId)).toBe(false);
      await as(member).post(`/groups/${groupId}/leave`).expect(404);

      // Membership history is retained rather than deleted.
      const row = await app
        .get<Model<GroupMember>>(getModelToken(GroupMember.name))
        .findOne({ group: new Types.ObjectId(groupId), user: new Types.ObjectId(member.id) });
      expect(row?.status).toBe(GroupMemberStatus.LEFT);
      expect(row?.endedAt).toBeInstanceOf(Date);
    });

    it('does not let the owner leave', async () => {
      const groupId = await createStaffedGroup();
      await as(owner).post(`/groups/${groupId}/leave`).expect(409);
      expect(await membersOf(groupId)).toContainEqual([owner.id, 'OWNER']);
    });
  });

  describe('updating metadata', () => {
    it('lets the owner and admins update, but not members or outsiders', async () => {
      const groupId = await createStaffedGroup();

      const byOwner = await as(owner)
        .patch(`/groups/${groupId}`, { name: 'Renamed', description: '' })
        .expect(200);
      expect(byOwner.body).toMatchObject({ name: 'Renamed', description: '' });
      await as(admin).patch(`/groups/${groupId}`, { description: 'By admin' }).expect(200);

      await as(member).patch(`/groups/${groupId}`, { name: 'Hijacked' }).expect(403);
      await as(outsider).patch(`/groups/${groupId}`, { name: 'Hijacked' }).expect(404);
      await as(owner).patch(`/groups/${groupId}`, {}).expect(400);
      await as(owner).patch(`/groups/${groupId}`, { createdBy: outsider.id }).expect(400);

      const group = (await as(member).get(`/groups/${groupId}`).expect(200)).body as GroupBody;
      expect(group).toMatchObject({ name: 'Renamed', description: 'By admin' });
    });
  });

  it('enforces a single owner per group at the database level', async () => {
    const group = await createGroup();
    const members = app.get<Model<GroupMember>>(getModelToken(GroupMember.name));

    await expect(
      members.create({
        group: new Types.ObjectId(group.id),
        user: new Types.ObjectId(candidate.id),
        role: GroupRole.OWNER,
        status: GroupMemberStatus.ACTIVE,
        joinedAt: new Date(),
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });
});
