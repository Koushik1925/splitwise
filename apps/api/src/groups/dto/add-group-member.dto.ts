import { IsMongoId } from 'class-validator';

/**
 * The id is only a reference: the service verifies server-side that the
 * caller may add members and is friends with this user. New members always
 * join as MEMBER; roles change via the role endpoint.
 */
export class AddGroupMemberDto {
  @IsMongoId()
  userId!: string;
}
