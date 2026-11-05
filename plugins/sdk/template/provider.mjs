/** Replace these functions with your provider's read-only API. Never log credentials. */
export async function readSnapshot(credentials, observedAt, signal) {
  signal.throwIfAborted();
  // Follow docs/operations/plugin-development.md for the snapshot schema.
  // Reject incomplete/failed responses; never turn an API failure into a zero balance.
  throw new Error('请先实现供应商 API 读取和快照映射');
}
export async function createAuthorization(input, observedAt, signal) {
  const snapshot = await readSnapshot(input, observedAt, signal);
  // Obtain the immutable provider account ID from the API, never from the key itself.
  throw new Error('请实现账户身份、只读权限校验与授权结果');
  // return { credentials: JSON.stringify(input), account: { id, label },
  //   permissions: ['account', 'positions'], snapshot, investmentBookId: 'crypto' };
}
