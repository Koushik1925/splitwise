import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { normalizeEmail } from '../../common/validation/transforms';
import { USER_EMAIL_MAX_LENGTH } from '../../users/schemas/user.schema';
import { PASSWORD_MAX_LENGTH } from '../auth.constants';

/**
 * Only the password's upper bound is enforced here (to cap hashing work).
 * The registration length policy is not re-applied at login, so a failed
 * login never reveals policy details beyond "invalid credentials".
 */
export class LoginDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(USER_EMAIL_MAX_LENGTH)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}
