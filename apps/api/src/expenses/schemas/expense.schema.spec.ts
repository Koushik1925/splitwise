import { ExpenseSchema } from './expense.schema';

describe('ExpenseSchema', () => {
  // A path typed Mixed would not cast string ids in queries (a filter on a
  // hex string silently matches nothing), so ids must be real ObjectId paths.
  it.each(['group', 'paidBy', 'createdBy', 'splits.user'])('%s is an ObjectId path', (path) => {
    expect(ExpenseSchema.path(path).instance).toBe('ObjectId');
  });

  it('declares the unique (createdBy, idempotencyKey) index that backs idempotency', () => {
    const unique = ExpenseSchema.indexes().find(
      ([fields, options]) =>
        options?.unique === true && JSON.stringify(fields) === '{"createdBy":1,"idempotencyKey":1}',
    );
    expect(unique).toBeDefined();
  });
});
