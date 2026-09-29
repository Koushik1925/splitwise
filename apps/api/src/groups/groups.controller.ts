import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import type { AuthPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { AddGroupMemberDto } from './dto/add-group-member.dto';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupMemberRoleDto } from './dto/update-group-member-role.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import type {
  GroupDetailResponse,
  GroupMemberResponse,
  GroupSummaryResponse,
} from './groups.presenter';
import { GroupsService } from './groups.service';

@Controller('groups')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Post()
  create(
    @CurrentUser() principal: AuthPrincipal,
    @Body() dto: CreateGroupDto,
  ): Promise<GroupDetailResponse> {
    return this.groups.createGroup(principal.userId, dto);
  }

  @Get()
  list(@CurrentUser() principal: AuthPrincipal): Promise<GroupSummaryResponse[]> {
    return this.groups.listGroups(principal.userId);
  }

  @Get(':groupId')
  get(
    @CurrentUser() principal: AuthPrincipal,
    @Param('groupId', ParseObjectIdPipe) groupId: string,
  ): Promise<GroupDetailResponse> {
    return this.groups.getGroup(principal.userId, groupId);
  }

  @Patch(':groupId')
  update(
    @CurrentUser() principal: AuthPrincipal,
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @Body() dto: UpdateGroupDto,
  ): Promise<GroupDetailResponse> {
    return this.groups.updateGroup(principal.userId, groupId, dto);
  }

  @Post(':groupId/members')
  addMember(
    @CurrentUser() principal: AuthPrincipal,
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @Body() dto: AddGroupMemberDto,
  ): Promise<GroupMemberResponse> {
    return this.groups.addMember(principal.userId, groupId, dto.userId);
  }

  @Patch(':groupId/members/:userId')
  updateMemberRole(
    @CurrentUser() principal: AuthPrincipal,
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @Param('userId', ParseObjectIdPipe) memberUserId: string,
    @Body() dto: UpdateGroupMemberRoleDto,
  ): Promise<GroupMemberResponse> {
    return this.groups.updateMemberRole(principal.userId, groupId, memberUserId, dto.role);
  }

  @Delete(':groupId/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(
    @CurrentUser() principal: AuthPrincipal,
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @Param('userId', ParseObjectIdPipe) memberUserId: string,
  ): Promise<void> {
    return this.groups.removeMember(principal.userId, groupId, memberUserId);
  }

  @Post(':groupId/leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  leave(
    @CurrentUser() principal: AuthPrincipal,
    @Param('groupId', ParseObjectIdPipe) groupId: string,
  ): Promise<void> {
    return this.groups.leaveGroup(principal.userId, groupId);
  }
}
