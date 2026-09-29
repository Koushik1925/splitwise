import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, type HydratedDocument } from 'mongoose';

export const GROUP_NAME_MAX_LENGTH = 100;
export const GROUP_DESCRIPTION_MAX_LENGTH = 500;

/**
 * Group metadata only. Membership and roles — including who currently owns
 * the group — live in GroupMember, the single source of truth for access.
 * No financial totals are stored here; group balances will be derived from
 * expenses and settlements.
 */
@Schema({ collection: 'groups', timestamps: true })
export class Group {
  @Prop({ required: true, trim: true, maxlength: GROUP_NAME_MAX_LENGTH })
  name!: string;

  @Prop({ trim: true, maxlength: GROUP_DESCRIPTION_MAX_LENGTH, default: '' })
  description!: string;

  /** Immutable provenance. Not an authorization field — see GroupMember.role. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, immutable: true })
  createdBy!: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export type GroupDocument = HydratedDocument<Group>;

export const GroupSchema = SchemaFactory.createForClass(Group);
