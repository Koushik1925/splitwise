import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const validConfig = {
    MONGODB_URI: 'mongodb://localhost:27017/splitwise',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'super-secret',
  };

  it('applies defaults for optional fields', () => {
    const env = validateEnv(validConfig);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.CORS_ORIGIN).toBe('http://localhost:3000');
  });

  it('coerces PORT to a number', () => {
    const env = validateEnv({ ...validConfig, PORT: '5000' });
    expect(env.PORT).toBe(5000);
  });

  it('throws when a required field is missing', () => {
    const { MONGODB_URI: _MONGODB_URI, ...rest } = validConfig;
    expect(() => validateEnv(rest)).toThrow(/MONGODB_URI/);
  });

  it('throws when NODE_ENV is not a recognised value', () => {
    expect(() => validateEnv({ ...validConfig, NODE_ENV: 'staging' })).toThrow();
  });

  it('defaults the auth token lifetime to seven days', () => {
    expect(validateEnv(validConfig).AUTH_TOKEN_TTL_SECONDS).toBe(604800);
  });

  it('coerces AUTH_TOKEN_TTL_SECONDS and rejects non-positive values', () => {
    expect(
      validateEnv({ ...validConfig, AUTH_TOKEN_TTL_SECONDS: '3600' }).AUTH_TOKEN_TTL_SECONDS,
    ).toBe(3600);
    expect(() => validateEnv({ ...validConfig, AUTH_TOKEN_TTL_SECONDS: '0' })).toThrow(
      /AUTH_TOKEN_TTL_SECONDS/,
    );
  });

  it('rejects a short JWT_SECRET in production', () => {
    expect(() => validateEnv({ ...validConfig, NODE_ENV: 'production' })).toThrow(/JWT_SECRET/);
  });

  it('accepts a 32+ character JWT_SECRET in production', () => {
    const env = validateEnv({
      ...validConfig,
      NODE_ENV: 'production',
      JWT_SECRET: 'x'.repeat(32),
    });
    expect(env.NODE_ENV).toBe('production');
  });
});
