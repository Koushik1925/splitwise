import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { trimString } from '../../common/validation/transforms';
import { GROUP_DESCRIPTION_MAX_LENGTH, GROUP_NAME_MAX_LENGTH } from '../schemas/group.schema';

/** Metadata only; membership and roles have their own endpoints. An empty description clears it. */
export class UpdateGroupDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(GROUP_NAME_MAX_LENGTH)
  name?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(GROUP_DESCRIPTION_MAX_LENGTH)
  description?: string;
}
