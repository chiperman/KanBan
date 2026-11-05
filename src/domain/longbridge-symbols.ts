/** 长桥美股期权代码：标的、YYMMDD、C/P 与可变长度行权价。 */
export function isLongbridgeUsOptionSymbol(symbol: string): boolean {
  const match = /^(?:[A-Z0-9.^_-]+)(\d{6})[CP]\d+\.US$/i.exec(symbol);
  if (match === null) return false;
  const expiration = match[1];
  if (expiration === undefined) return false;
  const year = 2000 + Number(expiration.slice(0, 2));
  const month = Number(expiration.slice(2, 4));
  const day = Number(expiration.slice(4, 6));
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * 当前产品只为长桥账户内已持有的普通证券提供 K 线。
 * 基金代码、现金、期权及不带受支持市场后缀的标的不会显示入口。
 */
export function supportsLongbridgeCandlesticks(symbol: string): boolean {
  return (
    !isLongbridgeUsOptionSymbol(symbol) &&
    /^[A-Z0-9.^_-]+\.(?:US|HK|SH|SZ|SG)$/i.test(symbol)
  );
}
