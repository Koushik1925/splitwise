import * as shared from '@splitwise/shared';
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
  ])('%s', (_name, apiEnum, sharedEnum) => {
    expect(Object.values(apiEnum).sort()).toEqual(Object.values(sharedEnum).sort());
  });
});
