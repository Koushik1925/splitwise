import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { trimString } from '../../common/validation/transforms';
import { GROUP_DESCRIPTION_MAX_LENGTH, GROUP_NAME_MAX_LENGTH } from '../schemas/group.schema';

/** The creator/owner is always the authenticated caller and cannot be supplied. */
export class CreateGroupDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(GROUP_NAME_MAX_LENGTH)
  name!: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(GROUP_DESCRIPTION_MAX_LENGTH)
  description?: string;
}
