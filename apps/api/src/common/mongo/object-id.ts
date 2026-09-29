import { Types } from 'mongoose';

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

/**
 * Strict 24-hex-character check. `Types.ObjectId.isValid` also accepts any
 * 12-character string, which is too permissive for ids arriving from URLs,
 * request bodies, or token claims.
 */
export function isObjectIdString(value: unknown): value is string {
  return typeof value === 'string' && OBJECT_ID_PATTERN.test(value);
}

export function toObjectId(id: string | Types.ObjectId): Types.ObjectId {
  return typeof id === 'string' ? new Types.ObjectId(id) : id;
}

/** Canonical lowercase hex form, so ids from different sources compare with `===`. */
export function normalizeObjectId(id: string | Types.ObjectId): string {
  return toObjectId(id).toHexString();
}
