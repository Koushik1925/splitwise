import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, PipelineStage, Types } from 'mongoose';
import { normalizeObjectId, toObjectId } from '../common/mongo/object-id';
import { Expense } from '../expenses/schemas/expense.schema';
import { GroupsService } from '../groups/groups.service';
import { UsersService } from '../users/users.service';
import { netPairBalances, totalsByCurrency, type DirectedObligation } from './balance-calculator';
import {
  toBalanceSummary,
  toPairBalanceDetail,
  type BalanceSummaryResponse,
  type PairBalanceDetailResponse,
} from './balances.presenter';

interface ObligationRow {
  _id: {
    debtor: Types.ObjectId;
    creditor: Types.ObjectId;
    currency: string;
    group: Types.ObjectId | null;
  };
  amountMinor: number;
}

/**
 * Balances are never stored. Each request re-derives them from the immutable
 * expenses in two steps that mirror the domain model:
 *
 *  1. raw obligations: MongoDB unwinds each expense's embedded splits into
 *     directed `debtor -> payer` rows and sums them per (debtor, creditor,
 *     currency, group);
 *  2. netted balances: the pure calculator nets those rows pairwise for the
 *     caller (never across intermediaries).
 *
 * Only rows the caller is a party to are ever loaded, so a caller cannot see
 * anyone else's dealings. Later phases subtract verified payments per pair
 * here; expenses themselves are never touched.
 */
@Injectable()
export class BalancesService {
  constructor(
    @InjectModel(Expense.name) private readonly expenseModel: Model<Expense>,
    private readonly users: UsersService,
    private readonly groups: GroupsService,
  ) {}

  /** The caller's netted balance with everyone, optionally limited to one group's expenses. */
  async getBalances(userId: string, groupId?: string): Promise<BalanceSummaryResponse> {
    const me = toObjectId(normalizeObjectId(userId));
    const involvesMe = { $or: [{ paidBy: me }, { 'splits.user': me }] };

    let preFilter: Record<string, unknown> = involvesMe;
    if (groupId) {
      await this.groups.assertActiveMember(groupId, userId);
      preFilter = { group: toObjectId(groupId), ...involvesMe };
    }

    const obligations = await this.loadObligations(preFilter, involvesMe);
    const pairs = netPairBalances(obligations, me.toHexString());
    const profiles = await this.users.findPublicProfiles(pairs.map((pair) => pair.counterparty));
    return toBalanceSummary(pairs, totalsByCurrency(pairs), profiles);
  }

  /**
   * Gross and net amounts between the caller and one other user, with a
   * per-context breakdown. 404 when the two have no expense-derived
   * obligations at all, which is also the answer for unknown ids.
   */
  async getPairBalance(userId: string, otherUserId: string): Promise<PairBalanceDetailResponse> {
    const me = toObjectId(normalizeObjectId(userId));
    const them = toObjectId(normalizeObjectId(otherUserId));
    if (me.equals(them)) {
      throw new BadRequestException('You cannot have a balance with yourself');
    }

    const preFilter = { paidBy: { $in: [me, them] }, 'splits.user': { $in: [me, them] } };
    const betweenUs = {
      $or: [
        { paidBy: me, 'splits.user': them },
        { paidBy: them, 'splits.user': me },
      ],
    };
    const obligations = await this.loadObligations(preFilter, betweenUs);
    const pairs = netPairBalances(obligations, me.toHexString());
    if (pairs.length === 0) {
      throw new NotFoundException('No balance with this user');
    }

    const counterparty = (await this.users.findPublicProfiles([them.toHexString()])).get(
      them.toHexString(),
    );
    if (!counterparty) {
      throw new NotFoundException('No balance with this user');
    }
    const groupNames = await this.groups.findGroupNames(
      pairs.flatMap((pair) =>
        pair.contexts.flatMap((context) => (context.group ? [context.group] : [])),
      ),
    );
    return toPairBalanceDetail(counterparty, pairs, groupNames);
  }

  /**
   * Raw obligations: one row per (debtor, creditor, currency, group). The
   * payer's own share and zero shares are not debts and are dropped.
   * `preFilter` narrows expenses using the indexes; `postFilter` then keeps
   * only the unwound splits the caller is a party to.
   */
  private async loadObligations(
    preFilter: Record<string, unknown>,
    postFilter: Record<string, unknown>,
  ): Promise<DirectedObligation[]> {
    const pipeline: PipelineStage[] = [
      { $match: preFilter },
      { $unwind: '$splits' },
      {
        $match: {
          'splits.owedMinor': { $gt: 0 },
          $expr: { $ne: ['$splits.user', '$paidBy'] },
          ...postFilter,
        },
      },
      {
        $group: {
          _id: {
            debtor: '$splits.user',
            creditor: '$paidBy',
            currency: '$currency',
            group: '$group',
          },
          amountMinor: { $sum: '$splits.owedMinor' },
        },
      },
    ];
    const rows = await this.expenseModel.aggregate<ObligationRow>(pipeline).exec();
    return rows.map((row) => ({
      debtor: row._id.debtor.toHexString(),
      creditor: row._id.creditor.toHexString(),
      currency: row._id.currency,
      group: row._id.group ? row._id.group.toHexString() : null,
      amountMinor: row.amountMinor,
    }));
  }
}
