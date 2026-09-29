/**
 * Identity and social contracts: the JSON shapes returned by the API's
 * auth, users, friends, and groups endpoints.
 *
 * The API defines its own copies of these enums (it compiles to CommonJS
 * and cannot load this TypeScript-source package at runtime).
 * `apps/api/src/shared-contract.spec.ts` fails if the two sets of values
 * drift apart.
 */

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}

export enum FriendshipStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
}

export enum GroupRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
}

/** The authenticated user's own account (`GET /api/v1/users/me`). */
export interface UserProfile {
  id: string;
  name: string;
  email: string;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
}

/** How a user appears to other users. */
export interface PublicUser {
  id: string;
  name: string;
  email: string;
}

/** Body of successful register/login responses; the token itself is only ever in an httpOnly cookie. */
export interface AuthResponse {
  user: UserProfile;
}

export interface FriendRequestSummary {
  id: string;
  status: FriendshipStatus;
  requester: PublicUser;
  addressee: PublicUser;
  requestedAt: string;
  respondedAt: string | null;
}

export interface FriendSummary {
  friendshipId: string;
  user: PublicUser;
  since: string;
}

export interface GroupSummary {
  id: string;
  name: string;
  description: string;
  /** The caller's role in the group. */
  role: GroupRole;
  createdAt: string;
  updatedAt: string;
}

export interface GroupMemberSummary {
  user: PublicUser;
  role: GroupRole;
  joinedAt: string;
}

export interface GroupDetail extends GroupSummary {
  members: GroupMemberSummary[];
}
