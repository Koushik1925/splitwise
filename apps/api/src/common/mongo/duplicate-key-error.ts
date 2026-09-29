const MONGO_DUPLICATE_KEY_ERROR_CODE = 11000;

/**
 * True when a write was rejected by a unique index. Services rely on unique
 * indexes (not read-then-write checks alone) to stay correct under
 * concurrent requests, and translate this error into a 409 Conflict.
 */
export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === MONGO_DUPLICATE_KEY_ERROR_CODE
  );
}
