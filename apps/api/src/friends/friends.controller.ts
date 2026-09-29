import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { SendFriendRequestDto } from './dto/send-friend-request.dto';
import type { FriendRequestResponse, FriendResponse } from './friends.presenter';
import { FriendsService } from './friends.service';

@Controller('friends')
export class FriendsController {
  constructor(private readonly friends: FriendsService) {}

  @Get()
  listFriends(@CurrentUser() principal: AuthPrincipal): Promise<FriendResponse[]> {
    return this.friends.listFriends(principal.userId);
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeFriend(
    @CurrentUser() principal: AuthPrincipal,
    @Param('userId', ParseObjectIdPipe) friendUserId: string,
  ): Promise<void> {
    return this.friends.removeFriend(principal.userId, friendUserId);
  }

  @Post('requests')
  sendRequest(
    @CurrentUser() principal: AuthPrincipal,
    @Body() dto: SendFriendRequestDto,
  ): Promise<FriendRequestResponse> {
    return this.friends.sendRequest(principal.userId, dto.email);
  }

  @Get('requests/incoming')
  listIncoming(@CurrentUser() principal: AuthPrincipal): Promise<FriendRequestResponse[]> {
    return this.friends.listIncomingRequests(principal.userId);
  }

  @Get('requests/outgoing')
  listOutgoing(@CurrentUser() principal: AuthPrincipal): Promise<FriendRequestResponse[]> {
    return this.friends.listOutgoingRequests(principal.userId);
  }

  @Post('requests/:requestId/accept')
  @HttpCode(HttpStatus.OK)
  accept(
    @CurrentUser() principal: AuthPrincipal,
    @Param('requestId', ParseObjectIdPipe) requestId: string,
  ): Promise<FriendRequestResponse> {
    return this.friends.acceptRequest(principal.userId, requestId);
  }

  @Post('requests/:requestId/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @CurrentUser() principal: AuthPrincipal,
    @Param('requestId', ParseObjectIdPipe) requestId: string,
  ): Promise<FriendRequestResponse> {
    return this.friends.rejectRequest(principal.userId, requestId);
  }

  @Delete('requests/:requestId')
  @HttpCode(HttpStatus.NO_CONTENT)
  cancel(
    @CurrentUser() principal: AuthPrincipal,
    @Param('requestId', ParseObjectIdPipe) requestId: string,
  ): Promise<void> {
    return this.friends.cancelRequest(principal.userId, requestId);
  }
}
