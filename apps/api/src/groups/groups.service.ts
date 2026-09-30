import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { isDuplicateKeyError } from '../common/mongo/duplicate-key-error';
import { normalizeObjectId, toObjectId } from '../common/mongo/object-id';
import { FriendsService } from '../friends/friends.service';
import { toPublicUser } from '../users/user.presenter';
import { UsersService } from '../users/users.service';
import type { CreateGroupDto } from './dto/create-group.dto';
import type { UpdateGroupDto } from './dto/update-group.dto';
import {
  canAddMembers,
  canChangeMemberRoles,
  canLeaveGroup,
  canRemoveMember,
  canUpdateGroup,
  type AssignableGroupRole,
} from './group.permissions';
import {
  compareGroupMembers,
  toGroupMember,
  toGroupSummary,
  type GroupDetailResponse,
  type GroupMemberResponse,
  type GroupSummaryResponse,
} from './groups.presenter';
import { Group } from './schemas/group.schema';
import {
  GroupMember,
  GroupMemberStatus,
  GroupRole,
  type GroupMemberDocument,
} from './schemas/group-member.schema';

const MEMBERSHIP_CHANGED_MESSAGE =
  'This membership changed while processing your request. Please try again.';

/**
 * Groups and memberships. Every operation first resolves the caller's
 * *active* membership; a group the caller does not belong to is reported as
 * 404 (not 403) so its existence isn't revealed. Role rules come from
 * group.permissions.ts, and writes repeat the relevant conditions in their
 * filters (status, role) so a concurrent change can't slip past a check.
 */
@Injectable()
export class GroupsService {
  constructor(
    @InjectModel(Group.name) private readonly groupModel: Model<Group>,
    @InjectModel(GroupMember.name) private readonly memberModel: Model<GroupMember>,
    private readonly users: UsersService,
    private readonly friends: FriendsService,
  ) {}

  async createGroup(userId: string, dto: CreateGroupDto): Promise<GroupDetailResponse> {
    const group = await this.groupModel.create({
      name: dto.name,
      description: dto.description ?? '',
      createdBy: toObjectId(userId),
    });
    try {
      await this.memberModel.create({
        group: group._id,
        user: toObjectId(userId),
        role: GroupRole.OWNER,
        status: GroupMemberStatus.ACTIVE,
        joinedAt: new Date(),
        addedBy: null,
      });
    } catch (error) {
      // MongoDB here is standalone (no multi-document transactions), so undo
      // the group insert rather than leave an ownerless group behind.
      await this.groupModel.deleteOne({ _id: group._id }).exec();
      throw error;
    }
    return this.buildGroupDetail(group.id as string, GroupRole.OWNER);
  }

  async listGroups(userId: string): Promise<GroupSummaryResponse[]> {
    const memberships = await this.memberModel
      .find({ user: toObjectId(userId), status: GroupMemberStatus.ACTIVE })
      .exec();
    const roleByGroupId = new Map(
      memberships.map((membership) => [membership.group.toHexString(), membership.role]),
    );
    const groups = await this.groupModel
      .find({ _id: { $in: memberships.map((membership) => membership.group) } })
      .sort({ createdAt: -1 })
      .exec();
    return groups.flatMap((group) => {
      const role = roleByGroupId.get(group.id as string);
      return role ? [toGroupSummary(group, role)] : [];
    });
  }

  async getGroup(userId: string, groupId: string): Promise<GroupDetailResponse> {
    const membership = await this.requireActiveMembership(groupId, userId);
    return this.buildGroupDetail(groupId, membership.role);
  }

  async updateGroup(
    userId: string,
    groupId: string,
    dto: UpdateGroupDto,
  ): Promise<GroupDetailResponse> {
    const membership = await this.requireActiveMembership(groupId, userId);
    if (!canUpdateGroup(membership.role)) {
      throw new ForbiddenException('Only the group owner or an admin can update the group');
    }

    const changes: Partial<Pick<Group, 'name' | 'description'>> = {};
    if (dto.name !== undefined) {
      changes.name = dto.name;
    }
    if (dto.description !== undefined) {
      changes.description = dto.description;
    }
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('Provide a name or description to update');
    }

    await this.groupModel
      .updateOne({ _id: toObjectId(groupId) }, { $set: changes }, { runValidators: true })
      .exec();
    return this.buildGroupDetail(groupId, membership.role);
  }

  /**
   * Owners and admins may add users who are *their own* friends. This keeps
   * group membership inside an existing, mutually accepted relationship —
   * nobody can be added to a group by a stranger.
   */
  async addMember(
    userId: string,
    groupId: string,
    newMemberUserId: string,
  ): Promise<GroupMemberResponse> {
    const newMemberId = normalizeObjectId(newMemberUserId);
    const actor = await this.requireActiveMembership(groupId, userId);
    if (!canAddMembers(actor.role)) {
      throw new ForbiddenException('Only the group owner or an admin can add members');
    }
    if (newMemberId === userId) {
      throw new ConflictException('You are already a member of this group');
    }
    // Checked before looking the user up, so probing arbitrary ids reveals
    // nothing about which accounts exist.
    if (!(await this.friends.areFriends(userId, newMemberId))) {
      throw new ForbiddenException('You can only add users who are your friends');
    }
    const newMember = await this.users.findActiveById(newMemberId);
    if (!newMember) {
      throw new NotFoundException('User not found');
    }

    const membership = await this.activateMembership(groupId, newMemberId, userId);
    return toGroupMember(membership, toPublicUser(newMember));
  }

  async updateMemberRole(
    userId: string,
    groupId: string,
    memberUserId: string,
    role: AssignableGroupRole,
  ): Promise<GroupMemberResponse> {
    const memberId = normalizeObjectId(memberUserId);
    const actor = await this.requireActiveMembership(groupId, userId);
    if (!canChangeMemberRoles(actor.role)) {
      throw new ForbiddenException('Only the group owner can change member roles');
    }
    if (memberId === userId) {
      throw new ForbiddenException(
        'The owner role cannot be changed; ownership transfer is not supported',
      );
    }

    const updated = await this.memberModel
      .findOneAndUpdate(
        {
          group: toObjectId(groupId),
          user: toObjectId(memberId),
          status: GroupMemberStatus.ACTIVE,
          role: { $ne: GroupRole.OWNER },
        },
        { $set: { role } },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new NotFoundException('Member not found');
    }
    const profile = (await this.users.findPublicProfiles([memberId])).get(memberId);
    if (!profile) {
      throw new NotFoundException('Member not found');
    }
    return toGroupMember(updated, profile);
  }

  async removeMember(userId: string, groupId: string, memberUserId: string): Promise<void> {
    const memberId = normalizeObjectId(memberUserId);
    const actor = await this.requireActiveMembership(groupId, userId);
    if (memberId === userId) {
      throw new BadRequestException('Use the leave endpoint to leave a group');
    }

    const target = await this.memberModel
      .findOne({
        group: toObjectId(groupId),
        user: toObjectId(memberId),
        status: GroupMemberStatus.ACTIVE,
      })
      .exec();
    if (!target) {
      throw new NotFoundException('Member not found');
    }
    if (target.role === GroupRole.OWNER) {
      throw new ForbiddenException('The group owner cannot be removed');
    }
    if (!canRemoveMember(actor.role, target.role)) {
      throw new ForbiddenException('You do not have permission to remove this member');
    }

    // Matching on the role that was authorized means a concurrent promotion
    // (e.g. MEMBER -> ADMIN) makes this a no-op rather than an unauthorized removal.
    const result = await this.memberModel
      .updateOne(
        { _id: target._id, status: GroupMemberStatus.ACTIVE, role: target.role },
        {
          $set: {
            status: GroupMemberStatus.REMOVED,
            endedAt: new Date(),
            removedBy: toObjectId(userId),
          },
        },
      )
      .exec();
    if (result.modifiedCount === 0) {
      throw new ConflictException(MEMBERSHIP_CHANGED_MESSAGE);
    }
  }

  async leaveGroup(userId: string, groupId: string): Promise<void> {
    const membership = await this.requireActiveMembership(groupId, userId);
    if (!canLeaveGroup(membership.role)) {
      throw new ConflictException(
        'The group owner cannot leave the group. Ownership transfer is not supported yet.',
      );
    }

    const result = await this.memberModel
      .updateOne(
        {
          _id: membership._id,
          status: GroupMemberStatus.ACTIVE,
          role: { $ne: GroupRole.OWNER },
        },
        { $set: { status: GroupMemberStatus.LEFT, endedAt: new Date() } },
      )
      .exec();
    if (result.modifiedCount === 0) {
      throw new ConflictException(MEMBERSHIP_CHANGED_MESSAGE);
    }
  }

  /** 404 unless the caller is an active member (same response as an unknown group). */
  async assertActiveMember(groupId: string, userId: string): Promise<void> {
    await this.requireActiveMembership(groupId, userId);
  }

  /** Of `userIds`, those who are currently ACTIVE members of the group. */
  async getActiveMemberIds(groupId: string, userIds: readonly string[]): Promise<Set<string>> {
    const ids = [...new Set(userIds.map((id) => normalizeObjectId(id)))];
    if (ids.length === 0) {
      return new Set();
    }
    const memberships = await this.memberModel
      .find({
        group: toObjectId(groupId),
        user: { $in: ids.map((id) => toObjectId(id)) },
        status: GroupMemberStatus.ACTIVE,
      })
      .exec();
    return new Set(memberships.map((membership) => membership.user.toHexString()));
  }

  /** Group names by id, for labelling expenses and balances. Membership is not checked here. */
  async findGroupNames(groupIds: readonly string[]): Promise<Map<string, string>> {
    const ids = [...new Set(groupIds.map((id) => normalizeObjectId(id)))];
    if (ids.length === 0) {
      return new Map();
    }
    const groups = await this.groupModel
      .find({ _id: { $in: ids.map((id) => toObjectId(id)) } })
      .select('name')
      .exec();
    return new Map(groups.map((group) => [group.id as string, group.name]));
  }

  /** Adds a first-time member, or reactivates someone who previously left or was removed. */
  private async activateMembership(
    groupId: string,
    memberId: string,
    addedById: string,
  ): Promise<GroupMemberDocument> {
    const key = { group: toObjectId(groupId), user: toObjectId(memberId) };
    const existing = await this.memberModel.findOne(key).exec();
    if (existing?.status === GroupMemberStatus.ACTIVE) {
      throw new ConflictException('This user is already a member of the group');
    }

    const activeMembership = {
      role: GroupRole.MEMBER,
      status: GroupMemberStatus.ACTIVE,
      joinedAt: new Date(),
      addedBy: toObjectId(addedById),
      endedAt: null,
      removedBy: null,
    };

    if (existing) {
      const reactivated = await this.memberModel
        .findOneAndUpdate(
          { _id: existing._id, status: { $ne: GroupMemberStatus.ACTIVE } },
          { $set: activeMembership },
          { new: true },
        )
        .exec();
      if (!reactivated) {
        throw new ConflictException('This user is already a member of the group');
      }
      return reactivated;
    }

    try {
      return await this.memberModel.create({ ...key, ...activeMembership });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('This user is already a member of the group');
      }
      throw error;
    }
  }

  private async requireActiveMembership(
    groupId: string,
    userId: string,
  ): Promise<GroupMemberDocument> {
    const membership = await this.memberModel
      .findOne({
        group: toObjectId(groupId),
        user: toObjectId(userId),
        status: GroupMemberStatus.ACTIVE,
      })
      .exec();
    if (!membership) {
      // Same response whether the group doesn't exist or the caller isn't in it.
      throw new NotFoundException('Group not found');
    }
    return membership;
  }

  private async buildGroupDetail(
    groupId: string,
    callerRole: GroupRole,
  ): Promise<GroupDetailResponse> {
    const [group, memberships] = await Promise.all([
      this.groupModel.findById(toObjectId(groupId)).exec(),
      this.memberModel
        .find({ group: toObjectId(groupId), status: GroupMemberStatus.ACTIVE })
        .exec(),
    ]);
    if (!group) {
      throw new NotFoundException('Group not found');
    }

    const profiles = await this.users.findPublicProfiles(
      memberships.map((membership) => membership.user.toHexString()),
    );
    const members = memberships
      .flatMap((membership) => {
        const user = profiles.get(membership.user.toHexString());
        return user ? [toGroupMember(membership, user)] : [];
      })
      .sort(compareGroupMembers);

    return { ...toGroupSummary(group, callerRole), members };
  }
}
