import type { UserDocument, UserStatus } from './schemas/user.schema';

/**
 * Response shapes are built field-by-field (never by serialising the
 * document) so sensitive fields such as `passwordHash` cannot leak through
 * API responses even if they were selected by a query.
 */

/** The authenticated user's own account. */
export interface UserProfileResponse {
  id: string;
  name: string;
  email: string;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
}

/** How a user appears to other users (friends, group members, requests). */
export interface PublicUserResponse {
  id: string;
  name: string;
  email: string;
}

export function toUserProfile(user: UserDocument): UserProfileResponse {
  return {
    id: user.id as string,
    name: user.name,
    email: user.email,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export function toPublicUser(
  user: Pick<UserDocument, 'id' | 'name' | 'email'>,
): PublicUserResponse {
  return {
    id: user.id as string,
    name: user.name,
    email: user.email,
  };
}
