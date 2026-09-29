import {
  canAddMembers,
  canChangeMemberRoles,
  canLeaveGroup,
  canRemoveMember,
  canUpdateGroup,
} from './group.permissions';
import { GroupRole } from './schemas/group-member.schema';

const { OWNER, ADMIN, MEMBER } = GroupRole;

describe('group permissions', () => {
  it.each([
    [OWNER, true],
    [ADMIN, true],
    [MEMBER, false],
  ])('canUpdateGroup(%s) = %s', (role, expected) => {
    expect(canUpdateGroup(role)).toBe(expected);
  });

  it.each([
    [OWNER, true],
    [ADMIN, true],
    [MEMBER, false],
  ])('canAddMembers(%s) = %s', (role, expected) => {
    expect(canAddMembers(role)).toBe(expected);
  });

  it.each([
    [OWNER, ADMIN, true],
    [OWNER, MEMBER, true],
    [ADMIN, MEMBER, true],
    [ADMIN, ADMIN, false],
    [MEMBER, MEMBER, false],
    [MEMBER, ADMIN, false],
    // Nobody can remove the owner — not even another owner-level actor.
    [OWNER, OWNER, false],
    [ADMIN, OWNER, false],
    [MEMBER, OWNER, false],
  ])('canRemoveMember(actor=%s, target=%s) = %s', (actor, target, expected) => {
    expect(canRemoveMember(actor, target)).toBe(expected);
  });

  it.each([
    [OWNER, true],
    [ADMIN, false],
    [MEMBER, false],
  ])('canChangeMemberRoles(%s) = %s', (role, expected) => {
    expect(canChangeMemberRoles(role)).toBe(expected);
  });

  it.each([
    [OWNER, false],
    [ADMIN, true],
    [MEMBER, true],
  ])('canLeaveGroup(%s) = %s', (role, expected) => {
    expect(canLeaveGroup(role)).toBe(expected);
  });
});
