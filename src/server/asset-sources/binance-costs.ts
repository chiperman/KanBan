import { decimalAdd, decimalCompare, decimalDivide, decimalMultiply, decimalSubtract } from "@/domain/decimal";
import { createJsonDecoder, type JsonRecord } from "@/server/asset-sources/json";
import { integer } from "@/server/asset-sources/binance-json";
import {
  eligibleUsdtSymbols,
  stocksSymbolForAsset,
  type BinanceEquityQuote,
} from "@/server/asset-sources/binance-market";
import type { BinanceClient } from "@/server/asset-sources/binance-client";
import type { BinancePosition } from "@/server/asset-sources/binance-positions";
import { positiveDecimal } from "@/server/asset-sources/value-guards";

const { record, list, text, nonNegativeDecimal: decimal, identifier } = createJsonDecoder("Binance");
const positive = positiveDecimal;

interface BinanceEquityOrder {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: string;
  filledTotal: string;
  fee: string;
  updatedAt: number;
}

interface BinanceSpotTrade {
  id: number;
  symbol: string;
  price: string;
  quantity: string;
  quoteQuantity: string;
  commission: string;
  commissionAsset: string;
  isBuyer: boolean;
}

function spotTrade(value: JsonRecord, symbol: string): BinanceSpotTrade {
  const returnedSymbol = text(value.symbol, "symbol");
  if (returnedSymbol !== symbol) {
    throw new Error(
      `Binance 现货成交返回的交易对不匹配：期望 ${symbol}，实际 ${returnedSymbol}`,
    );
  }
  if (typeof value.isBuyer !== "boolean") {
    throw new Error("Binance 现货成交响应缺少 isBuyer");
  }
  return {
    id: integer(value.id, "id"),
    symbol: returnedSymbol,
    price: decimal(value.price, "price"),
    quantity: decimal(value.qty, "qty"),
    quoteQuantity: decimal(value.quoteQty, "quoteQty"),
    commission: decimal(value.commission, "commission"),
    commissionAsset: text(value.commissionAsset, "commissionAsset"),
    isBuyer: value.isBuyer,
  };
}

function spotCostPrice(input: {
  asset: string;
  quantity: string;
  trades: readonly BinanceSpotTrade[];
}): string | null {
  if (!positive(input.quantity)) return null;

  let heldQuantity = "0";
  let heldCost = "0";
  for (const trade of [...input.trades].sort((left, right) => left.id - right.id)) {
    const commissionIsBaseAsset = trade.commissionAsset === input.asset;
    const commissionIsQuoteAsset = trade.commissionAsset === "USDT";
    if (trade.isBuyer) {
      if (
        positive(trade.commission) &&
        !commissionIsBaseAsset &&
        !commissionIsQuoteAsset
      ) {
        return null;
      }
      const acquiredQuantity = commissionIsBaseAsset
        ? decimalSubtract(trade.quantity, trade.commission)
        : trade.quantity;
      if (!positive(acquiredQuantity)) return null;
      const acquiredCost = commissionIsQuoteAsset
        ? decimalAdd(trade.quoteQuantity, trade.commission)
        : trade.quoteQuantity;
      heldQuantity = decimalAdd(heldQuantity, acquiredQuantity);
      heldCost = decimalAdd(heldCost, acquiredCost);
      continue;
    }

    const disposedQuantity = commissionIsBaseAsset
      ? decimalAdd(trade.quantity, trade.commission)
      : trade.quantity;
    if (decimalCompare(disposedQuantity, heldQuantity) > 0) return null;
    if (decimalCompare(disposedQuantity, heldQuantity) === 0) {
      heldQuantity = "0";
      heldCost = "0";
      continue;
    }
    heldCost = decimalSubtract(
      heldCost,
      decimalMultiply(
        heldCost,
        decimalDivide(disposedQuantity, heldQuantity),
      ),
    );
    heldQuantity = decimalSubtract(heldQuantity, disposedQuantity);
  }

  if (decimalCompare(heldQuantity, input.quantity) !== 0 || !positive(heldCost)) {
    return null;
  }
  return decimalDivide(heldCost, heldQuantity);
}

async function collectSpotTrades(
  client: BinanceClient,
  symbol: string,
): Promise<BinanceSpotTrade[]> {
  const output: BinanceSpotTrade[] = [];
  const seenIds = new Set<number>();
  let fromId = 0;
  for (let page = 0; page < 100; page += 1) {
    const rows = list(
      await client.spotTrades(symbol, fromId),
      `Binance ${symbol} 现货成交`,
    ).map((row) => spotTrade(row, symbol));
    if (rows.length > 1000) {
      throw new Error(`Binance ${symbol} 现货成交单页数量超过 1000`);
    }
    for (const row of rows) {
      if (row.id < fromId || seenIds.has(row.id)) {
        throw new Error(`Binance ${symbol} 现货成交分页重复或倒退`);
      }
      seenIds.add(row.id);
      output.push(row);
    }
    if (rows.length < 1000) return output;
    const largestId = rows.reduce(
      (largest, row) => Math.max(largest, row.id),
      fromId,
    );
    if (largestId === Number.MAX_SAFE_INTEGER) {
      throw new Error(`Binance ${symbol} 现货成交编号超出安全范围`);
    }
    fromId = largestId + 1;
  }
  throw new Error(`Binance ${symbol} 现货成交超过安全分页上限`);
}

export async function readSpotCostPrices(input: {
  client: BinanceClient;
  positions: readonly BinancePosition[];
  exchangeInfo: unknown;
}): Promise<Map<string, string>> {
  const eligible = eligibleUsdtSymbols(input.exchangeInfo);
  const assets = new Set(
    input.positions.flatMap((position) =>
      position.account === "spot" &&
      position.asset !== "USDT" &&
      eligible.has(`${position.asset}USDT`)
        ? [position.asset]
        : []
    ),
  );
  const costs = new Map<string, string>();
  for (const asset of assets) {
    try {
      const cost = spotCostPrice({
        asset,
        quantity: input.positions.find(
          (position) => position.account === "spot" && position.asset === asset,
        )?.quantity ?? "0",
        trades: await collectSpotTrades(input.client, `${asset}USDT`),
      });
      if (cost !== null) costs.set(asset, cost);
    } catch {
      // 成交历史不足或无法严格换算时，保留成本价为空而不影响当前资产同步。
    }
  }
  return costs;
}

function equityQuote(value: unknown, expectedSymbol: string): BinanceEquityQuote {
  const quote = record(value, "Binance Stocks 报价响应");
  const symbol = text(quote.symbol, "symbol");
  if (symbol !== expectedSymbol) {
    throw new Error(
      `Binance Stocks 返回的报价标的不匹配：期望 ${expectedSymbol}，实际 ${symbol}`,
    );
  }
  const bidPrice = decimal(quote.bidPrice, "bidPrice");
  const askPrice = decimal(quote.askPrice, "askPrice");
  if (!positive(bidPrice) || !positive(askPrice)) {
    throw new Error("Binance Stocks 返回了非正买卖报价");
  }
  return { symbol, bidPrice, askPrice };
}

function equityOrder(value: JsonRecord, expectedSymbol: string): BinanceEquityOrder {
  const symbol = text(value.symbol, "symbol");
  if (symbol !== expectedSymbol) {
    throw new Error(
      `Binance Stocks 返回的订单标的不匹配：期望 ${expectedSymbol}，实际 ${symbol}`,
    );
  }
  const side = text(value.side, "side");
  if (side !== "BUY" && side !== "SELL") {
    throw new Error(`Binance Stocks 返回了不支持的订单方向：${side}`);
  }
  const quantity = decimal(value.filledQty, "filledQty");
  const filledTotal = decimal(value.filledTotal, "filledTotal");
  if (positive(quantity) && !positive(filledTotal)) {
    throw new Error("Binance Stocks 已成交订单缺少有效成交总额");
  }
  return {
    id: identifier(value.orderId, "orderId"),
    symbol,
    side,
    quantity,
    filledTotal,
    fee: decimal(value.fee, "fee"),
    updatedAt: integer(value.updatedAt, "updatedAt"),
  };
}

function equityCostPrice(input: {
  quantity: string;
  orders: readonly BinanceEquityOrder[];
}): string | null {
  if (!positive(input.quantity)) return null;

  let heldQuantity = "0";
  let heldCost = "0";
  for (const order of [...input.orders].sort(
    (left, right) => left.updatedAt - right.updatedAt || left.id.localeCompare(right.id),
  )) {
    if (!positive(order.quantity)) continue;

    if (order.side === "BUY") {
      heldQuantity = decimalAdd(heldQuantity, order.quantity);
      heldCost = decimalAdd(
        heldCost,
        decimalAdd(order.filledTotal, order.fee),
      );
      continue;
    }

    if (decimalCompare(order.quantity, heldQuantity) > 0) return null;
    if (decimalCompare(order.quantity, heldQuantity) === 0) {
      heldQuantity = "0";
      heldCost = "0";
      continue;
    }
    heldCost = decimalSubtract(
      heldCost,
      decimalMultiply(
        heldCost,
        decimalDivide(order.quantity, heldQuantity),
      ),
    );
    heldQuantity = decimalSubtract(heldQuantity, order.quantity);
  }

  if (decimalCompare(heldQuantity, input.quantity) !== 0 || !positive(heldCost)) {
    return null;
  }
  return decimalDivide(heldCost, heldQuantity);
}

export async function readBinanceStocksMarketData(input: {
  client: BinanceClient;
  positions: readonly BinancePosition[];
}): Promise<{
  equityQuotes: Map<string, BinanceEquityQuote>;
}> {
  if (!input.positions.some((position) => position.asset.startsWith("EQ_"))) {
    return { equityQuotes: new Map() };
  }
  const symbols = new Set(
    input.positions.flatMap((position) => {
      const symbol = stocksSymbolForAsset(position.asset);
      return symbol === null ? [] : [symbol];
    }),
  );
  const quotes = await Promise.all(
    [...symbols].map(async (symbol) => [
      symbol,
      equityQuote(await input.client.equityQuote(symbol), symbol),
    ] as const),
  );
  return {
    equityQuotes: new Map(quotes),
  };
}

async function collectBinanceStocksOrders(input: {
  client: BinanceClient;
  symbol: string;
  observedAt: string;
}): Promise<BinanceEquityOrder[]> {
  const endTime = Date.parse(input.observedAt);
  if (!Number.isSafeInteger(endTime) || endTime <= 0) {
    throw new Error("Binance Stocks 成本读取时间无效");
  }
  const output: BinanceEquityOrder[] = [];
  const seenIds = new Set<string>();
  let expectedTotal: number | null = null;
  for (let current = 1; current <= 100; current += 1) {
    const response = record(
      await input.client.equityOrderHistory(
        input.symbol,
        0,
        endTime,
        current,
        100,
      ),
      `Binance Stocks ${input.symbol} 订单历史`,
    );
    const total = integer(response.total, "total");
    const returnedCurrent = integer(response.page, "page");
    const size = integer(response.size, "size");
    if (returnedCurrent !== current || size > 100) {
      throw new Error(`Binance Stocks ${input.symbol} 订单历史分页无效`);
    }
    if (expectedTotal === null) expectedTotal = total;
    if (total !== expectedTotal) {
      throw new Error(`Binance Stocks ${input.symbol} 订单历史 total 发生变化`);
    }
    const orders = list(
      response.rows,
      `Binance Stocks ${input.symbol} 订单历史 rows`,
    ).map((row) => equityOrder(row, input.symbol));
    if (orders.length > 100) {
      throw new Error(`Binance Stocks ${input.symbol} 订单历史单页数量超过 100`);
    }
    for (const order of orders) {
      if (seenIds.has(order.id)) {
        throw new Error(`Binance Stocks ${input.symbol} 订单历史分页重复`);
      }
      seenIds.add(order.id);
      output.push(order);
    }
    if (output.length >= total) {
      if (output.length !== total) {
        throw new Error(`Binance Stocks ${input.symbol} 订单历史数量超过 total`);
      }
      return output;
    }
    if (orders.length === 0) {
      throw new Error(`Binance Stocks ${input.symbol} 订单历史分页提前结束`);
    }
  }
  throw new Error(`Binance Stocks ${input.symbol} 订单历史超过安全分页上限`);
}

export async function readBinanceStocksCostPrices(input: {
  client: BinanceClient;
  positions: readonly BinancePosition[];
  observedAt: string;
}): Promise<Map<string, string>> {
  const symbols = new Map<string, string>();
  for (const position of input.positions) {
    const symbol = stocksSymbolForAsset(position.asset);
    if (symbol === null) continue;
    symbols.set(
      symbol,
      decimalAdd(symbols.get(symbol) ?? "0", position.quantity),
    );
  }
  const costs = new Map<string, string>();
  for (const [symbol, quantity] of symbols) {
    try {
      const cost = equityCostPrice({
        quantity,
        orders: await collectBinanceStocksOrders({
          client: input.client,
          symbol,
          observedAt: input.observedAt,
        }),
      });
      if (cost !== null) costs.set(symbol, cost);
    } catch {
      // Binance Stocks 历史不足或无法严格换算时，保留成本价为空而不影响当前资产同步。
    }
  }
  return costs;
}
