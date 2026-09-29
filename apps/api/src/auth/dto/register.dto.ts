import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { normalizeEmail, trimString } from '../../common/validation/transforms';
import { USER_EMAIL_MAX_LENGTH, USER_NAME_MAX_LENGTH } from '../../users/schemas/user.schema';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../auth.constants';

export class RegisterDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(USER_NAME_MAX_LENGTH)
  name!: string;

  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(USER_EMAIL_MAX_LENGTH)
  email!: string;

  /** Not trimmed: whitespace is a legitimate part of a passphrase. */
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}
