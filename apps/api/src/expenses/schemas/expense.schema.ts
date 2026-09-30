import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, type HydratedDocument, type Types } from 'mongoose';
import { Currency, SUPPORTED_CURRENCIES } from '../../common/money/currencies';
import { isNonNegativeSafeInteger, isValidAmountMinor, sumMinor } from '../../common/money/money';

export const EXPENSE_DESCRIPTION_MAX_LENGTH = 200;
export const EXPENSE_MAX_PARTICIPANTS = 100;

export enum SplitMethod {
  EQUAL = 'EQUAL',
  EXACT = 'EXACT',
  PERCENTAGE = 'PERCENTAGE',
  SHARES = 'SHARES',
}

/**
 * One participant's share. `owedMinor` is the authoritative amount, computed
 * by the server; `input` records what the client supplied for auditing
 * (exact amount, basis points or share count; null for EQUAL).
 */
@Schema({ _id: false })
export class ExpenseSplit {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, immutable: true })
  user!: Types.ObjectId;

  @Prop({
    type: Number,
    required: true,
    immutable: true,
    validate: { validator: isNonNegativeSafeInteger, message: 'owedMinor must be an integer >= 0' },
  })
  owedMinor!: number;

  @Prop({ type: Number, default: null, immutable: true })
  input!: number | null;
}

const ExpenseSplitSchema = SchemaFactory.createForClass(ExpenseSplit);

/**
 * The original financial event. Immutable: no field can change after
 * insertion and no update/delete path exists, so settlements and payments
 * (a later phase) are recorded elsewhere and never rewrite an expense.
 *
 * Splits are embedded so the expense and its shares commit in one atomic
 * single-document insert (MongoDB here has no multi-document transactions),
 * which makes "shares sum to the total" a property of one document.
 *
 * No balance, running total or status is stored: balances are derived from
 * these rows on read.
 */
@Schema({ collection: 'expenses', timestamps: true })
export class Expense {
  /** Null for an expense between friends outside any group. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Group', default: null, immutable: true })
  group!: Types.ObjectId | null;

  @Prop({
    required: true,
    trim: true,
    minlength: 1,
    maxlength: EXPENSE_DESCRIPTION_MAX_LENGTH,
    immutable: true,
  })
  description!: string;

  /** Total in minor units (paise for INR). */
  @Prop({
    type: Number,
    required: true,
    immutable: true,
    validate: { validator: isValidAmountMinor, message: 'amountMinor is out of range' },
  })
  amountMinor!: number;

  @Prop({ type: String, required: true, enum: SUPPORTED_CURRENCIES, immutable: true })
  currency!: Currency;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, immutable: true })
  paidBy!: Types.ObjectId;

  /** Always the authenticated caller who created the expense. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, immutable: true })
  createdBy!: Types.ObjectId;

  @Prop({ required: true, enum: Object.values(SplitMethod), immutable: true })
  splitMethod!: SplitMethod;

  @Prop({ type: [ExpenseSplitSchema], required: true, immutable: true })
  splits!: ExpenseSplit[];

  /** Client-supplied `Idempotency-Key`, unique per creator. */
  @Prop({ required: true, immutable: true })
  idempotencyKey!: string;

  /** Hash of the canonical request, to tell a true replay from key reuse with a different body. */
  @Prop({ required: true, immutable: true })
  requestHash!: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export type ExpenseDocument = HydratedDocument<Expense>;

export const ExpenseSchema = SchemaFactory.createForClass(Expense);

// "Expenses I paid" and "expenses I'm split on"; user queries $or these two.
ExpenseSchema.index({ paidBy: 1, _id: -1 });
ExpenseSchema.index({ 'splits.user': 1, _id: -1 });
// A group's expenses, newest first.
ExpenseSchema.index(
  { group: 1, _id: -1 },
  { partialFilterExpression: { group: { $type: 'objectId' } }, name: 'group_expenses' },
);
// The database is the final arbiter of duplicate submissions: two requests
// with the same creator and key cannot both insert, however they interleave.
ExpenseSchema.index({ createdBy: 1, idempotencyKey: 1 }, { unique: true });

// Model-level backstop for the financial invariants, in case a future write
// path bypasses ExpensesService.
ExpenseSchema.pre('validate', function (this: ExpenseDocument) {
  const { splits, amountMinor, paidBy } = this;
  if (!Array.isArray(splits) || typeof amountMinor !== 'number' || !paidBy) {
    return; // `required` validators report these
  }
  const users = splits.map((split) => split.user.toHexString());
  if (new Set(users).size !== users.length) {
    this.invalidate('splits', 'Split participants must be unique');
    return;
  }
  const owed = splits.map((split) => split.owedMinor);
  if (!owed.every(isNonNegativeSafeInteger)) {
    return; // the per-field validators report these
  }
  if (sumMinor(owed) !== amountMinor) {
    this.invalidate('splits', 'Split amounts must sum to the expense total');
  }
  const hasDebtor = splits.some((split) => !split.user.equals(paidBy) && split.owedMinor > 0);
  if (!hasDebtor) {
    this.invalidate('splits', 'An expense needs at least one debtor other than the payer');
  }
});
