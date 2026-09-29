/** httpOnly cookie carrying the access-token JWT. */
export const ACCESS_TOKEN_COOKIE = 'access_token';

export const JWT_ALGORITHM = 'HS256';
export const JWT_ISSUER = 'splitwise-api';
export const JWT_AUDIENCE = 'splitwise-web';

/**
 * Single message for every credential failure (unknown email, wrong
 * password, inactive account) so login responses don't reveal which
 * accounts exist.
 */
export const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';

export const PASSWORD_MIN_LENGTH = 8;
/** Caps hashing work per request; well above any realistic passphrase. */
export const PASSWORD_MAX_LENGTH = 128;
