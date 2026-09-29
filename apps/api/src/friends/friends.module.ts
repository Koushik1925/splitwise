import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { FriendsController } from './friends.controller';
import { FriendsService } from './friends.service';
import { Friendship, FriendshipSchema } from './schemas/friendship.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Friendship.name, schema: FriendshipSchema }]),
    UsersModule,
  ],
  controllers: [FriendsController],
  providers: [FriendsService],
  exports: [FriendsService],
})
export class FriendsModule {}
