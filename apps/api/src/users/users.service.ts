import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { isDuplicateKeyError } from '../common/mongo/duplicate-key-error';
import { isObjectIdString, normalizeObjectId, toObjectId } from '../common/mongo/object-id';
import { User, UserStatus, type UserDocument } from './schemas/user.schema';
import {
  toPublicUser,
  toUserProfile,
  type PublicUserResponse,
  type UserProfileResponse,
} from './user.presenter';

export interface CreateUserInput {
  name: string;
  email: string;
  passwordHash: string;
}

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly userModel: Model<User>) {}

  /** @throws ConflictException when the email is already registered. */
  async create(input: CreateUserInput): Promise<UserDocument> {
    try {
      return await this.userModel.create({
        name: input.name,
        email: normalizeEmail(input.email),
        passwordHash: input.passwordHash,
        status: UserStatus.ACTIVE,
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('An account with this email already exists');
      }
      throw error;
    }
  }

  /** The only lookup that loads `passwordHash`; used exclusively for credential checks. */
  findByEmailWithPasswordHash(email: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ email: normalizeEmail(email) })
      .select('+passwordHash')
      .exec();
  }

  findActiveByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ email: normalizeEmail(email), status: UserStatus.ACTIVE })
      .exec();
  }

  async findActiveById(userId: string): Promise<UserDocument | null> {
    if (!isObjectIdString(userId)) {
      return null;
    }
    return this.userModel.findOne({ _id: toObjectId(userId), status: UserStatus.ACTIVE }).exec();
  }

  /** Of the given ids, those that belong to ACTIVE users (normalized hex ids). */
  async findActiveIds(userIds: readonly string[]): Promise<Set<string>> {
    const uniqueIds = [...new Set(userIds.map((id) => normalizeObjectId(id)))];
    if (uniqueIds.length === 0) {
      return new Set();
    }
    const users = await this.userModel
      .find({ _id: { $in: uniqueIds.map((id) => toObjectId(id)) }, status: UserStatus.ACTIVE })
      .select('_id')
      .exec();
    return new Set(users.map((user) => user.id as string));
  }

  /**
   * Profile of the authenticated caller. A valid session whose user no longer
   * exists or is no longer active is treated as unauthenticated.
   */
  async getCurrentUserProfile(userId: string): Promise<UserProfileResponse> {
    const user = await this.findActiveById(userId);
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }
    return toUserProfile(user);
  }

  /** Batch lookup for building friend / member / request views; keyed by normalized id. */
  async findPublicProfiles(userIds: readonly string[]): Promise<Map<string, PublicUserResponse>> {
    const uniqueIds = [...new Set(userIds.map((id) => normalizeObjectId(id)))];
    if (uniqueIds.length === 0) {
      return new Map();
    }
    const users = await this.userModel
      .find({ _id: { $in: uniqueIds.map((id) => toObjectId(id)) } })
      .select('name email')
      .exec();
    return new Map(users.map((user) => [user.id as string, toPublicUser(user)]));
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
