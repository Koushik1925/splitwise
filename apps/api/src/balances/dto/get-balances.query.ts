import { IsMongoId, IsOptional } from 'class-validator';

export class GetBalancesQuery {
  /** Restrict to one group's expenses (the caller must be an active member). */
  @IsOptional()
  @IsMongoId()
  groupId?: string;
}
