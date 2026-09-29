import { z } from 'zod';

const SEVEN_DAYS_IN_SECONDS = 60 * 60 * 24 * 7;
const MIN_PRODUCTION_JWT_SECRET_LENGTH = 32;

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
    REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
    JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
    // Lifetime of both the access-token JWT and its server-side session record.
    AUTH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(SEVEN_DAYS_IN_SECONDS),
    EMAIL_PROVIDER_API_KEY: z.string().optional(),
    SMS_PROVIDER_API_KEY: z.string().optional(),
    UPI_PROVIDER_KEY: z.string().optional(),
    UPI_PROVIDER_SECRET: z.string().optional(),
    CORS_ORIGIN: z.string().default('http://localhost:3000'),
  })
  .superRefine((env, ctx) => {
    // HS256 secrets shorter than the hash output are brute-forceable offline
    // from any issued token. Short secrets stay allowed outside production so
    // local/CI setups keep working with simple values.
    if (env.NODE_ENV === 'production' && env.JWT_SECRET.length < MIN_PRODUCTION_JWT_SECRET_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_SECRET'],
        message: `JWT_SECRET must be at least ${MIN_PRODUCTION_JWT_SECRET_LENGTH} characters in production`,
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
