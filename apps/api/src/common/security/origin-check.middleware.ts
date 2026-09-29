import type { NextFunction, Request, Response } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence-in-depth for cookie-authenticated requests.
 *
 * The auth cookie is SameSite=Lax, which already stops cross-site form
 * posts. SameSite does not distinguish sibling subdomains, though, so this
 * middleware additionally rejects any state-changing request whose `Origin`
 * header is present but is not the trusted web origin.
 *
 * Requests without an `Origin` header come from non-browser clients (curl,
 * server-to-server, tests). Those cannot ride a victim's browser cookies, so
 * they continue to normal authentication rather than being blocked here.
 */
export function createOriginCheckMiddleware(allowedOrigins: readonly string[]) {
  const allowed = new Set(allowedOrigins);

  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (SAFE_METHODS.has(req.method) || origin === undefined || allowed.has(origin)) {
      next();
      return;
    }
    res.status(403).json({ statusCode: 403, message: 'Origin not allowed', error: 'Forbidden' });
  };
}
