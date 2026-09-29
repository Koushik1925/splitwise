import { IsIn } from 'class-validator';
import { ASSIGNABLE_GROUP_ROLES, type AssignableGroupRole } from '../group.permissions';

/** OWNER is deliberately not assignable: ownership transfer is not supported. */
export class UpdateGroupMemberRoleDto {
  @IsIn(ASSIGNABLE_GROUP_ROLES)
  role!: AssignableGroupRole;
}
