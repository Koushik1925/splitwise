import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  type HttpException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { FilterQuery, Model } from 'mongoose';
import { isDuplicateKeyError } from '../common/mongo/duplicate-key-error';
import { toObjectId } from '../common/mongo/object-id';
import { UsersService } from '../users/users.service';
import {
  decideOnExistingRelationship,
  toFriendshipPair,
  type FriendshipPair,
} from './friendship.rules';
import {
  toFriendRequestResponse,
  toFriendResponse,
  type FriendRequestResponse,
  type FriendResponse,
} from './friends.presenter';
import { Friendship, FriendshipStatus, type FriendshipDocument } from './schemas/friendship.schema';

/**
 * Friend relationships. Every state transition is a single conditional
 * write whose filter encodes who may perform it and from which state
 * (e.g. accept = `{ addressee: caller, status: PENDING }`), so authorization
 * and state checks cannot be raced by concurrent requests.
 */
@Injectable()
export class FriendsService {
  constructor(
    @InjectModel(Friendship.name) private readonly friendshipModel: Model<Friendship>,
    private readonly users: UsersService,
  ) {}

  async sendRequest(senderId: string, recipientEmail: string): Promise<FriendRequestResponse> {
    const recipient = await this.users.findActiveByEmail(recipientEmail);
    if (!recipient) {
      throw new NotFoundException('No user found with that email');
    }
    const recipientId = recipient.id as string;
    if (recipientId === senderId) {
      throw new BadRequestException('You cannot send a friend request to yourself');
    }

    const pair = toFriendshipPair(senderId, recipientId);
    const existing = await this.friendshipModel.findOne(pair).exec();
    const request = existing
      ? await this.reopenRejectedRequest(existing, senderId, recipientId)
      : await this.createRequest(pair, senderId, recipientId);
    return this.toRequestResponse(request);
  }

  acceptRequest(userId: string, requestId: string): Promise<FriendRequestResponse> {
    return this.respondToRequest(userId, requestId, FriendshipStatus.ACCEPTED);
  }

  rejectRequest(userId: string, requestId: string): Promise<FriendRequestResponse> {
    return this.respondToRequest(userId, requestId, FriendshipStatus.REJECTED);
  }

  /** The sender withdraws a request that is still pending. */
  async cancelRequest(userId: string, requestId: string): Promise<void> {
    const result = await this.friendshipModel
      .deleteOne({
        _id: toObjectId(requestId),
        requester: toObjectId(userId),
        status: FriendshipStatus.PENDING,
      })
      .exec();
    if (result.deletedCount === 0) {
      throw await this.explainRequestActionFailure(userId, requestId, 'cancel');
    }
  }

  /**
   * Deletes an accepted friendship so either user may send a new request
   * later. (Once expenses exist, this will also need to consult the balance
   * engine before allowing removal.)
   */
  async removeFriend(userId: string, friendUserId: string): Promise<void> {
    if (userId === friendUserId) {
      throw new NotFoundException('Friend not found');
    }
    const result = await this.friendshipModel
      .deleteOne({ ...toFriendshipPair(userId, friendUserId), status: FriendshipStatus.ACCEPTED })
      .exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException('Friend not found');
    }
  }

  async listFriends(userId: string): Promise<FriendResponse[]> {
    const friendships = await this.friendshipModel
      .find(involving(userId, { status: FriendshipStatus.ACCEPTED }))
      .exec();
    const profiles = await this.users.findPublicProfiles(
      friendships.map((friendship) => otherParticipantId(friendship, userId)),
    );
    return friendships
      .flatMap((friendship) => {
        const friend = profiles.get(otherParticipantId(friendship, userId));
        return friend ? [toFriendResponse(friendship, friend)] : [];
      })
      .sort((a, b) => a.user.name.localeCompare(b.user.name));
  }

  async listIncomingRequests(userId: string): Promise<FriendRequestResponse[]> {
    const requests = await this.friendshipModel
      .find(involving(userId, { addressee: toObjectId(userId), status: FriendshipStatus.PENDING }))
      .sort({ requestedAt: -1 })
      .exec();
    return this.toRequestResponses(requests);
  }

  async listOutgoingRequests(userId: string): Promise<FriendRequestResponse[]> {
    const requests = await this.friendshipModel
      .find(involving(userId, { requester: toObjectId(userId), status: FriendshipStatus.PENDING }))
      .sort({ requestedAt: -1 })
      .exec();
    return this.toRequestResponses(requests);
  }

  /** Used by other modules (e.g. groups) to authorize friend-scoped actions. */
  async areFriends(firstUserId: string, secondUserId: string): Promise<boolean> {
    if (firstUserId === secondUserId) {
      return false;
    }
    const friendship = await this.friendshipModel
      .exists({ ...toFriendshipPair(firstUserId, secondUserId), status: FriendshipStatus.ACCEPTED })
      .exec();
    return friendship !== null;
  }

  private async createRequest(
    pair: FriendshipPair,
    senderId: string,
    recipientId: string,
  ): Promise<FriendshipDocument> {
    try {
      return await this.friendshipModel.create({
        ...pair,
        requester: toObjectId(senderId),
        addressee: toObjectId(recipientId),
        status: FriendshipStatus.PENDING,
        requestedAt: new Date(),
        respondedAt: null,
      });
    } catch (error) {
      // Lost a race with a concurrent request for the same pair (either direction).
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('A friend request or friendship with this user already exists');
      }
      throw error;
    }
  }

  private async reopenRejectedRequest(
    existing: FriendshipDocument,
    senderId: string,
    recipientId: string,
  ): Promise<FriendshipDocument> {
    const decision = decideOnExistingRelationship(
      { status: existing.status, requesterId: existing.requester.toHexString() },
      senderId,
    );
    if (decision.action === 'deny') {
      throw new ConflictException(decision.reason);
    }

    const reopened = await this.friendshipModel
      .findOneAndUpdate(
        { _id: existing._id, status: FriendshipStatus.REJECTED, addressee: toObjectId(senderId) },
        {
          $set: {
            requester: toObjectId(senderId),
            addressee: toObjectId(recipientId),
            status: FriendshipStatus.PENDING,
            requestedAt: new Date(),
            respondedAt: null,
          },
        },
        { new: true },
      )
      .exec();
    if (!reopened) {
      throw new ConflictException(
        'This friendship changed while processing your request. Please try again.',
      );
    }
    return reopened;
  }

  private async respondToRequest(
    userId: string,
    requestId: string,
    outcome: FriendshipStatus.ACCEPTED | FriendshipStatus.REJECTED,
  ): Promise<FriendRequestResponse> {
    const updated = await this.friendshipModel
      .findOneAndUpdate(
        {
          _id: toObjectId(requestId),
          addressee: toObjectId(userId),
          status: FriendshipStatus.PENDING,
        },
        { $set: { status: outcome, respondedAt: new Date() } },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw await this.explainRequestActionFailure(userId, requestId, 'respond');
    }
    return this.toRequestResponse(updated);
  }

  /**
   * Called only after a conditional write matched nothing, to pick the right
   * status code. Requests the caller isn't part of are reported as 404 so
   * their existence isn't revealed.
   */
  private async explainRequestActionFailure(
    userId: string,
    requestId: string,
    action: 'respond' | 'cancel',
  ): Promise<HttpException> {
    const request = await this.friendshipModel.findById(toObjectId(requestId)).exec();
    if (!request || !isParticipant(request, userId)) {
      return new NotFoundException('Friend request not found');
    }
    if (request.status !== FriendshipStatus.PENDING) {
      return new ConflictException('This friend request is no longer pending');
    }
    return action === 'respond'
      ? new ForbiddenException('Only the recipient can respond to this friend request')
      : new ForbiddenException('Only the sender can cancel this friend request');
  }

  private async toRequestResponses(
    requests: FriendshipDocument[],
  ): Promise<FriendRequestResponse[]> {
    const profiles = await this.users.findPublicProfiles(
      requests.flatMap((request) => [
        request.requester.toHexString(),
        request.addressee.toHexString(),
      ]),
    );
    return requests.flatMap((request) => {
      const requester = profiles.get(request.requester.toHexString());
      const addressee = profiles.get(request.addressee.toHexString());
      return requester && addressee ? [toFriendRequestResponse(request, requester, addressee)] : [];
    });
  }

  private async toRequestResponse(request: FriendshipDocument): Promise<FriendRequestResponse> {
    const [response] = await this.toRequestResponses([request]);
    if (!response) {
      throw new NotFoundException('Friend request not found');
    }
    return response;
  }
}

/**
 * Relationships involving `userId`, with `extra` pushed into both branches so
 * each branch is served by an index ({userA, userB} or {userB, status}).
 */
function involving(userId: string, extra: FilterQuery<Friendship>): FilterQuery<Friendship> {
  const id = toObjectId(userId);
  return {
    $or: [
      { userA: id, ...extra },
      { userB: id, ...extra },
    ],
  };
}

function isParticipant(friendship: FriendshipDocument, userId: string): boolean {
  return friendship.userA.toHexString() === userId || friendship.userB.toHexString() === userId;
}

function otherParticipantId(friendship: FriendshipDocument, userId: string): string {
  return friendship.userA.toHexString() === userId
    ? friendship.userB.toHexString()
    : friendship.userA.toHexString();
}
