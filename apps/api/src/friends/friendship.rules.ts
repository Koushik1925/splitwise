import type { Types } from 'mongoose';
import { normalizeObjectId, toObjectId } from '../common/mongo/object-id';
import { FriendshipStatus } from './schemas/friendship.schema';

export interface FriendshipPair {
  userA: Types.ObjectId;
  userB: Types.ObjectId;
}

/**
 * Canonical (order-independent) key for a pair of users: the same two users
 * always produce the same pair, regardless of argument order.
 */
export function toFriendshipPair(firstUserId: string, secondUserId: string): FriendshipPair {
  const first = normalizeObjectId(firstUserId);
  const second = normalizeObjectId(secondUserId);
  if (first === second) {
    throw new Error('A friendship requires two distinct users');
  }
  const [userA, userB] = first < second ? [first, second] : [second, first];
  return { userA: toObjectId(userA), userB: toObjectId(userB) };
}

export type SendRequestDecision = { action: 'reopen' } | { action: 'deny'; reason: string };

/**
 * What happens when `senderId` sends a request to someone they already have
 * a relationship document with.
 *
 * A rejected request can only be re-opened by the person who rejected it:
 * the original sender cannot re-send (no request spam after a "no"), but the
 * recipient can change their mind and send a request of their own.
 */
export function decideOnExistingRelationship(
  existing: { status: FriendshipStatus; requesterId: string },
  senderId: string,
): SendRequestDecision {
  const senderSentExisting = existing.requesterId === senderId;
  switch (existing.status) {
    case FriendshipStatus.ACCEPTED:
      return { action: 'deny', reason: 'You are already friends with this user' };
    case FriendshipStatus.PENDING:
      return {
        action: 'deny',
        reason: senderSentExisting
          ? 'You have already sent a friend request to this user'
          : 'This user has already sent you a friend request. Accept it instead.',
      };
    case FriendshipStatus.REJECTED:
      return senderSentExisting
        ? { action: 'deny', reason: 'A friend request cannot be sent to this user' }
        : { action: 'reopen' };
  }
}
