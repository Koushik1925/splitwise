import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, type HydratedDocument } from 'mongoose';

export enum GroupRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
}

export enum GroupMemberStatus {
  ACTIVE = 'ACTIVE',
  LEFT = 'LEFT',
  REMOVED = 'REMOVED',
}

/**
 * A user's membership in a group. Rows are never deleted: leaving or being
 * removed changes `status`, so the fact that someone *was* a member survives
 * for future expense history and balance calculations. Re-adding a former
 * member reactivates the same row.
 */
@Schema({ collection: 'group_members', timestamps: true })
export class GroupMember {
  @Prop({ type: Types.ObjectId, ref: 'Group', required: true, immutable: true })
  group!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, immutable: true })
  user!: Types.ObjectId;

  @Prop({ required: true, enum: Object.values(GroupRole) })
  role!: GroupRole;

  @Prop({
    required: true,
    enum: Object.values(GroupMemberStatus),
    default: GroupMemberStatus.ACTIVE,
  })
  status!: GroupMemberStatus;

  /** Start of the current (or most recent) membership period. */
  @Prop({ type: Date, required: true })
  joinedAt!: Date;

  /** Who added this member; null for the creator. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  addedBy!: Types.ObjectId | null;

  /** When the membership ended (LEFT or REMOVED); null while active. */
  @Prop({ type: Date, default: null })
  endedAt!: Date | null;

  /** Who removed this member; set only when status is REMOVED. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  removedBy!: Types.ObjectId | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export type GroupMemberDocument = HydratedDocument<GroupMember>;

export const GroupMemberSchema = SchemaFactory.createForClass(GroupMember);

// One membership row per (group, user): prevents duplicate membership, and
// serves "members of group" lookups via its `group` prefix.
GroupMemberSchema.index({ group: 1, user: 1 }, { unique: true });
// "Groups this user belongs to".
GroupMemberSchema.index({ user: 1, status: 1 });
// Database-level guarantee of at most one owner per group. Owners can
// neither leave nor be removed, so an owner row is always active.
GroupMemberSchema.index(
  { group: 1 },
  {
    unique: true,
    partialFilterExpression: { role: GroupRole.OWNER },
    name: 'group_single_owner',
  },
);
