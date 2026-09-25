/**
 * Canonical financial state enums. These are the only valid values for their
 * respective fields across the API and frontend — never widen or bypass them
 * with free-text strings, since the backend is the single source of truth
 * for all financial state transitions.
 */

export enum PaymentMethod {
  UPI = 'UPI',
  CASH = 'CASH',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
}

export enum SettlementStatus {
  OPEN = 'OPEN',
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  PENDING_CONFIRMATION = 'PENDING_CONFIRMATION',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum NotificationChannel {
  EMAIL = 'EMAIL',
  SMS = 'SMS',
  PUSH = 'PUSH',
  IN_APP = 'IN_APP',
}
