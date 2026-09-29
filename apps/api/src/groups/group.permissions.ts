import { GroupRole } from './schemas/group-member.schema';

/**
 * Role-based rules for group actions, kept free of I/O so the whole matrix
 * is unit-testable. GroupsService applies them after resolving the caller's
 * active membership (non-members never reach these checks).
 *
 * | action                       | OWNER | ADMIN          | MEMBER |
 * | ---------------------------- | ----- | -------------- | ------ |
 * | view group & members         | yes   | yes            | yes    |
 * | update name / description    | yes   | yes            | no     |
 * | add members (own friends)    | yes   | yes            | no     |
 * | remove a member              | yes   | MEMBERs only   | no     |
 * | change roles (ADMIN/MEMBER)  | yes   | no             | no     |
 * | leave                        | no    | yes            | yes    |
 *
 * Nobody can remove the owner, and the owner cannot leave: ownership
 * transfer is a deliberate future feature, not a side effect.
 */
export function canUpdateGroup(role: GroupRole): boolean {
  return role === GroupRole.OWNER || role === GroupRole.ADMIN;
}

export function canAddMembers(role: GroupRole): boolean {
  return role === GroupRole.OWNER || role === GroupRole.ADMIN;
}

export function canRemoveMember(actorRole: GroupRole, targetRole: GroupRole): boolean {
  if (targetRole === GroupRole.OWNER) {
    return false;
  }
  if (actorRole === GroupRole.OWNER) {
    return true;
  }
  return actorRole === GroupRole.ADMIN && targetRole === GroupRole.MEMBER;
}

export function canChangeMemberRoles(role: GroupRole): boolean {
  return role === GroupRole.OWNER;
}

export function canLeaveGroup(role: GroupRole): boolean {
  return role !== GroupRole.OWNER;
}

/** Roles that can be granted through the role-change endpoint (never OWNER). */
export const ASSIGNABLE_GROUP_ROLES = [GroupRole.ADMIN, GroupRole.MEMBER] as const;
export type AssignableGroupRole = (typeof ASSIGNABLE_GROUP_ROLES)[number];
