import { PasswordHasher } from './password-hasher';

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();

  it('produces a self-describing scrypt hash that never contains the password', async () => {
    const hash = await hasher.hash('correct horse battery staple');
    expect(hash).toMatch(/^scrypt\$15\$8\$3\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(hash).not.toContain('correct horse');
  });

  it('verifies the correct password', async () => {
    const hash = await hasher.hash('correct horse battery staple');
    await expect(hasher.verify(hash, 'correct horse battery staple')).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hasher.hash('correct horse battery staple');
    await expect(hasher.verify(hash, 'Correct horse battery staple')).resolves.toBe(false);
  });

  it('uses a unique salt per hash', async () => {
    const [first, second] = await Promise.all([hasher.hash('same'), hasher.hash('same')]);
    expect(first).not.toBe(second);
  });

  it('treats Unicode-equivalent passwords as equal (NFKC)', async () => {
    const composed = 'café-password';
    const decomposed = 'café-password';
    const hash = await hasher.hash(composed);
    await expect(hasher.verify(hash, decomposed)).resolves.toBe(true);
  });

  it.each([
    '',
    'not-a-hash',
    'bcrypt$15$8$3$c2FsdA==$a2V5',
    'scrypt$99$8$3$c2FsdA==$a2V5',
    'scrypt$15$8$3$c2FsdA==$',
  ])('returns false for malformed stored hash %p', async (stored) => {
    await expect(hasher.verify(stored, 'anything')).resolves.toBe(false);
  });
});
