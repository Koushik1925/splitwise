import type { Request } from 'express';

/**
 * The server-verified identity of the caller. This is the only source of
 * "who is making this request" — never a user id from a body, query, or path.
 */
export interface AuthPrincipal {
  userId: string;
  sessionId: string;
}

/** Claims carried in the access-token JWT (iss/aud/iat/exp are added by JwtModule). */
export interface AccessTokenClaims {
  sub: string;
  jti: string;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthPrincipal;
}
