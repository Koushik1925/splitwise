import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, type HydratedDocument } from 'mongoose';

export enum FriendshipStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
}

/**
 * One document per unordered pair of users, whatever its state or whoever
 * initiated it.
 *
 * Direction is represented twice, on purpose:
 * - `userA`/`userB` hold the two participants in canonical order
 *   (userA's hex id sorts before userB's). The unique index on this pair is
 *   what makes A→B and B→A the *same* relationship, so concurrent requests in
 *   opposite directions cannot create two friendships.
 * - `requester`/`addressee` record who sent the current request and who may
 *   respond to it.
 */
@Schema({ collection: 'friendships', timestamps: true })
export class Friendship {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, immutable: true })
  userA!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, immutable: true })
  userB!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  requester!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  addressee!: Types.ObjectId;

  @Prop({
    required: true,
    enum: Object.values(FriendshipStatus),
    default: FriendshipStatus.PENDING,
  })
  status!: FriendshipStatus;

  /** When the current request was sent (reset if a rejected pair is re-requested). */
  @Prop({ type: Date, required: true })
  requestedAt!: Date;

  /** When the addressee accepted or rejected; null while pending. */
  @Prop({ type: Date, default: null })
  respondedAt!: Date | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export type FriendshipDocument = HydratedDocument<Friendship>;

export const FriendshipSchema = SchemaFactory.createForClass(Friendship);

// At most one relationship per pair; also serves lookups where the user is userA.
FriendshipSchema.index({ userA: 1, userB: 1 }, { unique: true });
// Lookups where the user is userB (the userA side is covered by the index above).
FriendshipSchema.index({ userB: 1, status: 1 });

// Model-level guard for the pair invariants, in case a future write path
// bypasses FriendsService.
FriendshipSchema.pre('validate', function (this: FriendshipDocument) {
  const { userA, userB, requester, addressee } = this;
  if (!userA || !userB || !requester || !addressee) {
    return; // `required` validators report these
  }
  if (userA.toHexString() >= userB.toHexString()) {
    this.invalidate('userB', 'userA must sort strictly before userB');
  }
  const participants = [requester.toHexString(), addressee.toHexString()].sort();
  if (participants[0] !== userA.toHexString() || participants[1] !== userB.toHexString()) {
    this.invalidate('requester', 'requester and addressee must be the two participants');
  }
});
