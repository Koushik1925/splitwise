import type { TransformFnParams } from 'class-transformer';

/** class-transformer helpers applied by the global ValidationPipe before validation runs. */

export function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * Emails are stored lowercased so the unique index on `users.email` is
 * effectively case-insensitive. Every DTO that accepts an email uses this.
 */
export function normalizeEmail({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}
