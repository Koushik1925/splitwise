import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Expense, ExpenseSchema } from '../expenses/schemas/expense.schema';
import { GroupsModule } from '../groups/groups.module';
import { UsersModule } from '../users/users.module';
import { BalancesController } from './balances.controller';
import { BalancesService } from './balances.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Expense.name, schema: ExpenseSchema }]),
    UsersModule,
    GroupsModule,
  ],
  controllers: [BalancesController],
  providers: [BalancesService],
})
export class BalancesModule {}
