/**
 * Sound feedback abstraction (interface only — no audio assets yet).
 * A future implementation in packages/ui will map each event to an audio
 * file and respect a user-level mute preference.
 */
export enum SoundEvent {
  EXPENSE_ADDED = 'expense-added',
  PAYMENT_STARTED = 'payment-started',
  PAYMENT_SUCCESS = 'payment-success',
  PARTIAL_PAYMENT = 'partial-payment',
  SETTLEMENT_COMPLETE = 'settlement-complete',
  PAYMENT_FAILED = 'payment-failed',
}

export interface SoundPlayer {
  play(event: SoundEvent): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
}
