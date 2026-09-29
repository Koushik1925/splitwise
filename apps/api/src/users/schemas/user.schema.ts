import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  /** Cannot sign in; reserved for future account suspension/deactivation flows. */
  DISABLED = 'DISABLED',
}

export const USER_NAME_MAX_LENGTH = 100;
export const USER_EMAIL_MAX_LENGTH = 254;

/**
 * Identity only. Deliberately carries no financial fields (balances,
 * amounts owed, etc.) — financial state is derived by the future balance
 * engine from expenses and settlements, never stored on the user.
 */
@Schema({ collection: 'users', timestamps: true })
export class User {
  @Prop({ required: true, trim: true, maxlength: USER_NAME_MAX_LENGTH })
  name!: string;

  /** Stored lowercased; uniqueness is enforced by the index below. */
  @Prop({ required: true, trim: true, lowercase: true, maxlength: USER_EMAIL_MAX_LENGTH })
  email!: string;

  /** scrypt hash (see PasswordHasher). Excluded from queries unless explicitly selected. */
  @Prop({ required: true, select: false })
  passwordHash!: string;

  @Prop({ required: true, enum: Object.values(UserStatus), default: UserStatus.ACTIVE })
  status!: UserStatus;

  createdAt!: Date;
  updatedAt!: Date;
}

export type UserDocument = HydratedDocument<User>;

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index({ email: 1 }, { unique: true });
