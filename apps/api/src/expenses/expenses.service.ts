import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { FilterQuery, Model } from 'mongoose';
import { isDuplicateKeyError } from '../common/mongo/duplicate-key-error';
import { normalizeObjectId, toObjectId } from '../common/mongo/object-id';
import { FriendsService } from '../friends/friends.service';
import { GroupsService } from '../groups/groups.service';
import { UsersService } from '../users/users.service';
import type { CreateExpenseDto } from './dto/create-expense.dto';
import { DEFAULT_EXPENSE_PAGE_SIZE, type ListExpensesQuery } from './dto/list-expenses.query';
import {
  computeSplits,
  hashExpenseRequest,
  involvedUserIds,
  isCreatorInvolved,
  parseIdempotencyKey,
  type ComputedSplit,
  type ExpenseInput,
} from './expense.rules';
import {
  toExpenseDetail,
  toExpenseSummary,
  userIdsOf,
  type ExpenseDetailResponse,
  type ExpenseListResponse,
} from './expenses.presenter';
import { Expense, type ExpenseDocument } from './schemas/expense.schema';

export interface CreateExpenseResult {
  expense: ExpenseDetailResponse;
  /** False when an earlier request with the same Idempotency-Key is being replayed. */
  created: boolean;
}

const KEY_REUSED_MESSAGE =
  'This Idempotency-Key was already used with a different request. Use a new key for a new expense.';

/**
 * Expenses are created once and never modified: there is no update or delete
 * here, and no method touches balances (those are derived on read).
 *
 * Creation is idempotent per (creator, Idempotency-Key). The unique index on
 * that pair is the final arbiter: concurrent identical requests all try to
 * insert, exactly one wins, and the losers receive the winner's expense.
 */
@Injectable()
export class ExpensesService {
  constructor(
    @InjectModel(Expense.name) private readonly expenseModel: Model<Expense>,
    private readonly users: UsersService,
    private readonly friends: FriendsService,
    private readonly groups: GroupsService,
  ) {}

  async createExpense(
    creatorId: string,
    idempotencyKeyHeader: unknown,
    dto: CreateExpenseDto,
  ): Promise<CreateExpenseResult> {
    const idempotencyKey = parseIdempotencyKey(idempotencyKeyHeader);
    const creator = normalizeObjectId(creatorId);

    const input: ExpenseInput = {
      groupId: dto.groupId ? normalizeObjectId(dto.groupId) : null,
      description: dto.description,
      amountMinor: dto.amountMinor,
      currency: dto.currency,
      paidBy: dto.paidBy ? normalizeObjectId(dto.paidBy) : creator,
      splitMethod: dto.splitMethod,
      participants: dto.participants,
    };
    // Pure server-side computation: the only source of every owed amount.
    const splits = computeSplits(input);
    const requestHash = hashExpenseRequest(input);

    const replay = await this.findReplay(creator, idempotencyKey, requestHash);
    if (replay) {
      return { expense: await this.present(replay, creator), created: false };
    }

    await this.authorize(creator, input, splits);

    try {
      const expense = await this.expenseModel.create({
        group: input.groupId ? toObjectId(input.groupId) : null,
        description: input.description,
        amountMinor: input.amountMinor,
        currency: input.currency,
        paidBy: toObjectId(input.paidBy),
        createdBy: toObjectId(creator),
        splitMethod: input.splitMethod,
        splits: splits.map((split) => ({
          user: toObjectId(split.user),
          owedMinor: split.owedMinor,
          input: split.input,
        })),
        idempotencyKey,
        requestHash,
      });
      return { expense: await this.present(expense, creator), created: true };
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
      // Lost a race with an identical (or conflicting) request using this key.
      const winner = await this.findReplay(creator, idempotencyKey, requestHash);
      if (!winner) {
        throw error;
      }
      return { expense: await this.present(winner, creator), created: false };
    }
  }

  async listExpenses(userId: string, query: ListExpensesQuery): Promise<ExpenseListResponse> {
    const viewerId = normalizeObjectId(userId);
    const limit = query.limit ?? DEFAULT_EXPENSE_PAGE_SIZE;

    const scope: FilterQuery<Expense> = {};
    if (query.groupId) {
      await this.groups.assertActiveMember(query.groupId, viewerId);
      scope.group = toObjectId(query.groupId);
    } else {
      const me = toObjectId(viewerId);
      scope.$or = [{ paidBy: me }, { 'splits.user': me }];
    }
    if (query.cursor) {
      scope._id = { $lt: toObjectId(query.cursor) };
    }

    const page = await this.expenseModel
      .find(scope)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .exec();
    const hasMore = page.length > limit;
    const expenses = hasMore ? page.slice(0, limit) : page;

    const context = await this.buildContext(expenses, viewerId);
    return {
      items: expenses.map((expense) => toExpenseSummary(expense, context)),
      nextCursor: hasMore ? (expenses[expenses.length - 1].id as string) : null,
    };
  }

  /** Visible to the payer, any participant, and active members of the expense's group. */
  async getExpense(userId: string, expenseId: string): Promise<ExpenseDetailResponse> {
    const viewerId = normalizeObjectId(userId);
    const expense = await this.expenseModel.findById(toObjectId(expenseId)).exec();
    if (!expense || !(await this.canView(expense, viewerId))) {
      throw new NotFoundException('Expense not found');
    }
    return this.present(expense, viewerId);
  }

  /**
   * Who may record this expense. Membership and friendship are checked at
   * creation time only; the expense stays valid if they change later.
   * Any id that is not usable reports the same message, so probing ids
   * reveals nothing about which accounts exist.
   */
  private async authorize(
    creatorId: string,
    input: ExpenseInput,
    splits: ComputedSplit[],
  ): Promise<void> {
    if (input.groupId) {
      // Non-members get the same 404 as an unknown group.
      await this.groups.assertActiveMember(input.groupId, creatorId);
    }
    if (!isCreatorInvolved(creatorId, input.paidBy, splits)) {
      throw new ForbiddenException(
        'You can only record expenses that you paid for or that you owe a share of',
      );
    }

    const involved = involvedUserIds(input.paidBy, splits);
    const activeUsers = await this.users.findActiveIds(involved);
    if (input.groupId) {
      const members = await this.groups.getActiveMemberIds(input.groupId, involved);
      if (involved.some((id) => !activeUsers.has(id) || !members.has(id))) {
        throw new ForbiddenException(
          'The payer and every participant must be active members of the group',
        );
      }
      return;
    }

    const friendsOfPayer = await this.friends.findFriendIds(
      input.paidBy,
      involved.filter((id) => id !== input.paidBy),
    );
    const everyoneUsable = involved.every(
      (id) => activeUsers.has(id) && (id === input.paidBy || friendsOfPayer.has(id)),
    );
    if (!everyoneUsable) {
      throw new ForbiddenException('Every participant must be an accepted friend of the payer');
    }
  }

  /**
   * An earlier expense for this (creator, key): returned when the request is
   * identical, and a 409 when the key is being reused for something else.
   */
  private async findReplay(
    creatorId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<ExpenseDocument | null> {
    const existing = await this.expenseModel
      .findOne({ createdBy: toObjectId(creatorId), idempotencyKey })
      .exec();
    if (!existing) {
      return null;
    }
    if (existing.requestHash !== requestHash) {
      throw new ConflictException(KEY_REUSED_MESSAGE);
    }
    return existing;
  }

  private async canView(expense: ExpenseDocument, viewerId: string): Promise<boolean> {
    if (
      expense.paidBy.toHexString() === viewerId ||
      expense.splits.some((split) => split.user.toHexString() === viewerId)
    ) {
      return true;
    }
    if (!expense.group) {
      return false;
    }
    const members = await this.groups.getActiveMemberIds(expense.group.toHexString(), [viewerId]);
    return members.has(viewerId);
  }

  private async present(
    expense: ExpenseDocument,
    viewerId: string,
  ): Promise<ExpenseDetailResponse> {
    return toExpenseDetail(expense, await this.buildContext([expense], viewerId));
  }

  private async buildContext(expenses: ExpenseDocument[], viewerId: string) {
    const [profiles, groupNames] = await Promise.all([
      this.users.findPublicProfiles(expenses.flatMap((expense) => userIdsOf(expense))),
      this.groups.findGroupNames(
        expenses.flatMap((expense) => (expense.group ? [expense.group.toHexString()] : [])),
      ),
    ]);
    return { viewerId, profiles, groupNames };
  }
}
