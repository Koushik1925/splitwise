import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';
import { normalizeEmail } from '../../common/validation/transforms';
import { USER_EMAIL_MAX_LENGTH } from '../../users/schemas/user.schema';

/** The sender is always the authenticated caller; only the recipient is supplied. */
export class SendFriendRequestDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(USER_EMAIL_MAX_LENGTH)
  email!: string;
}
