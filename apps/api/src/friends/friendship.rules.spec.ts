import { decideOnExistingRelationship, toFriendshipPair } from './friendship.rules';
import { FriendshipStatus } from './schemas/friendship.schema';

const LOW = '1000000000000000000000aa';
const HIGH = 'f000000000000000000000bb';

describe('toFriendshipPair', () => {
  it('orders the participants canonically', () => {
    const pair = toFriendshipPair(HIGH, LOW);
    expect(pair.userA.toHexString()).toBe(LOW);
    expect(pair.userB.toHexString()).toBe(HIGH);
  });

  it('produces the same pair regardless of direction', () => {
    const forward = toFriendshipPair(LOW, HIGH);
    const reverse = toFriendshipPair(HIGH, LOW);
    expect(forward.userA.equals(reverse.userA)).toBe(true);
    expect(forward.userB.equals(reverse.userB)).toBe(true);
  });

  it('normalizes id casing before comparing', () => {
    const pair = toFriendshipPair(HIGH.toUpperCase(), LOW);
    expect(pair.userB.toHexString()).toBe(HIGH);
  });

  it('refuses a self-pair', () => {
    expect(() => toFriendshipPair(LOW, LOW.toUpperCase())).toThrow();
  });
});

describe('decideOnExistingRelationship', () => {
  const sender = LOW;
  const other = HIGH;

  it('denies a request between existing friends', () => {
    expect(
      decideOnExistingRelationship(
        { status: FriendshipStatus.ACCEPTED, requesterId: other },
        sender,
      ),
    ).toEqual({ action: 'deny', reason: expect.stringMatching(/already friends/) });
  });

  it('denies a duplicate pending request from the same sender', () => {
    expect(
      decideOnExistingRelationship(
        { status: FriendshipStatus.PENDING, requesterId: sender },
        sender,
      ),
    ).toEqual({ action: 'deny', reason: expect.stringMatching(/already sent/) });
  });

  it('denies a reverse-direction request while one is pending, pointing to accept', () => {
    expect(
      decideOnExistingRelationship(
        { status: FriendshipStatus.PENDING, requesterId: other },
        sender,
      ),
    ).toEqual({ action: 'deny', reason: expect.stringMatching(/Accept it instead/) });
  });

  it('denies a rejected sender from re-sending', () => {
    expect(
      decideOnExistingRelationship(
        { status: FriendshipStatus.REJECTED, requesterId: sender },
        sender,
      ),
    ).toEqual({ action: 'deny', reason: expect.any(String) });
  });

  it('lets the user who rejected a request send one of their own', () => {
    expect(
      decideOnExistingRelationship(
        { status: FriendshipStatus.REJECTED, requesterId: other },
        sender,
      ),
    ).toEqual({ action: 'reopen' });
  });
});
