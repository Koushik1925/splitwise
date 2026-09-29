import type { PublicUserResponse } from '../users/user.presenter';
import type { GroupDocument } from './schemas/group.schema';
import { GroupRole, type GroupMemberDocument } from './schemas/group-member.schema';

export interface GroupSummaryResponse {
  id: string;
  name: string;
  description: string;
  /** The caller's role in this group. */
  role: GroupRole;
  createdAt: string;
  updatedAt: string;
}

export interface GroupMemberResponse {
  user: PublicUserResponse;
  role: GroupRole;
  joinedAt: string;
}

export interface GroupDetailResponse extends GroupSummaryResponse {
  members: GroupMemberResponse[];
}

const ROLE_ORDER: Record<GroupRole, number> = {
  [GroupRole.OWNER]: 0,
  [GroupRole.ADMIN]: 1,
  [GroupRole.MEMBER]: 2,
};

export function toGroupSummary(group: GroupDocument, callerRole: GroupRole): GroupSummaryResponse {
  return {
    id: group.id as string,
    name: group.name,
    description: group.description,
    role: callerRole,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  };
}

export function toGroupMember(
  membership: GroupMemberDocument,
  user: PublicUserResponse,
): GroupMemberResponse {
  return {
    user,
    role: membership.role,
    joinedAt: membership.joinedAt.toISOString(),
  };
}

/** Owner first, then admins, then members; alphabetical within a role. */
export function compareGroupMembers(a: GroupMemberResponse, b: GroupMemberResponse): number {
  return ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.user.name.localeCompare(b.user.name);
}
