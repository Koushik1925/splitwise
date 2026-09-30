import * as shared from '@splitwise/shared';
import { BalanceDirection } from './balances/balances.presenter';
import { Currency } from './common/money/currencies';
import { MAX_AMOUNT_MINOR } from './common/money/money';
import { MAX_SHARES_PER_PARTICIPANT, PERCENTAGE_TOTAL_BPS } from './expenses/expense.rules';
import {
  EXPENSE_DESCRIPTION_MAX_LENGTH,
  EXPENSE_MAX_PARTICIPANTS,
  SplitMethod,
} from './expenses/schemas/expense.schema';
import { FriendshipStatus } from './friends/schemas/friendship.schema';
import { GroupRole } from './groups/schemas/group-member.schema';
import { UserStatus } from './users/schemas/user.schema';

/**
 * The API keeps its own enum definitions (it can't load the TypeScript-source
 * shared package at runtime), and the web app consumes @splitwise/shared.
 * This fails if the values the API persists and returns drift from the
 * contract the frontend is written against.
 */
describe('API enums match the @splitwise/shared contract', () => {
  it.each([
    ['UserStatus', UserStatus, shared.UserStatus],
    ['FriendshipStatus', FriendshipStatus, shared.FriendshipStatus],
    ['GroupRole', GroupRole, shared.GroupRole],
    ['SplitMethod', SplitMethod, shared.SplitMethod],
    ['Currency', Currency, shared.Currency],
    ['BalanceDirection', BalanceDirection, shared.BalanceDirection],
  ])('%s', (_name, apiEnum, sharedEnum) => {
    expect(Object.values(apiEnum).sort()).toEqual(Object.values(sharedEnum).sort());
  });
});

describe('API expense limits match the @splitwise/shared contract', () => {
  it('agree on every limit', () => {
    expect({
      maxAmountMinor: MAX_AMOUNT_MINOR,
      descriptionMaxLength: EXPENSE_DESCRIPTION_MAX_LENGTH,
      maxParticipants: EXPENSE_MAX_PARTICIPANTS,
      maxSharesPerParticipant: MAX_SHARES_PER_PARTICIPANT,
      percentageTotalBps: PERCENTAGE_TOTAL_BPS,
    }).toEqual(shared.EXPENSE_LIMITS);
  });
});
