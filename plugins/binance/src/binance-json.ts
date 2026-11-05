export function integer(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`Binance 响应中的 ${field} 不是有效整数`);
  }
  return Number(value);
}
