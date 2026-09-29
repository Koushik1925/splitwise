import type { NextFunction, Request, Response } from 'express';
import { createOriginCheckMiddleware } from './origin-check.middleware';

function run(method: string, origin?: string) {
  const middleware = createOriginCheckMiddleware(['http://localhost:3000']);
  const req = { method, headers: origin === undefined ? {} : { origin } } as Request;
  const json = jest.fn();
  const res = { status: jest.fn().mockReturnValue({ json }) } as unknown as Response;
  const next = jest.fn() as NextFunction;
  middleware(req, res, next);
  return { next, res, json };
}

describe('createOriginCheckMiddleware', () => {
  it('allows safe methods from any origin', () => {
    expect(run('GET', 'https://evil.example').next).toHaveBeenCalled();
    expect(run('OPTIONS', 'https://evil.example').next).toHaveBeenCalled();
  });

  it('allows state-changing requests from the trusted origin', () => {
    expect(run('POST', 'http://localhost:3000').next).toHaveBeenCalled();
  });

  it('allows state-changing requests without an Origin header (non-browser clients)', () => {
    expect(run('DELETE').next).toHaveBeenCalled();
  });

  it.each(['POST', 'PATCH', 'PUT', 'DELETE'])(
    'rejects %s requests from an untrusted origin with 403',
    (method) => {
      const { next, res, json } = run(method, 'https://evil.example');
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    },
  );

  it('rejects the opaque "null" origin', () => {
    expect(run('POST', 'null').next).not.toHaveBeenCalled();
  });
});
