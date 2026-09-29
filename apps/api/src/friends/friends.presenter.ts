import type { PublicUserResponse } from '../users/user.presenter';
import type { FriendshipDocument, FriendshipStatus } from './schemas/friendship.schema';

export interface FriendRequestResponse {
  id: string;
  status: FriendshipStatus;
  requester: PublicUserResponse;
  addressee: PublicUserResponse;
  requestedAt: string;
  respondedAt: string | null;
}

export interface FriendResponse {
  friendshipId: string;
  user: PublicUserResponse;
  /** When the friendship was accepted. */
  since: string;
}

export function toFriendRequestResponse(
  friendship: FriendshipDocument,
  requester: PublicUserResponse,
  addressee: PublicUserResponse,
): FriendRequestResponse {
  return {
    id: friendship.id as string,
    status: friendship.status,
    requester,
    addressee,
    requestedAt: friendship.requestedAt.toISOString(),
    respondedAt: friendship.respondedAt ? friendship.respondedAt.toISOString() : null,
  };
}

export function toFriendResponse(
  friendship: FriendshipDocument,
  friend: PublicUserResponse,
): FriendResponse {
  return {
    friendshipId: friendship.id as string,
    user: friend,
    since: (friendship.respondedAt ?? friendship.updatedAt).toISOString(),
  };
}
