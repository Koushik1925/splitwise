import type { PaymentMethod, PaymentStatus, SettlementStatus } from './enums';

/**
 * Foundational shape of a Settlement (debt between two users).
 * Amounts are always expressed in the smallest currency unit (paise) to
 * avoid floating point drift in financial calculations.
 */
export interface SettlementSummary {
  id: string;
  fromUserId: string;
  toUserId: string;
  originalAmount: number;
  totalPaid: number;
  remainingAmount: number;
  status: SettlementStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Foundational shape of an immutable Payment record. Payments are append-only;
 * a settlement's remainingAmount is always derived, never edited directly.
 */
export interface PaymentSummary {
  id: string;
  settlementId: string;
  payerId: string;
  receiverId: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  providerTransactionId?: string;
  createdAt: string;
  completedAt?: string;
}

export interface ApiErrorBody {
  statusCode: number;
  message: string;
  error?: string;
}
