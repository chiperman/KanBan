import { decimalCompare } from "@/domain/decimal";
import type { AssetSnapshot } from "@/server/ports";

function record(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("来源插件返回的数据结构无效");
}
function text(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error("来源插件返回的文本无效");
}
function decimal(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[+-]?\d+(?:\.\d+)?$/.test(value)) throw new Error("来源插件金额必须为十进制字符串");
}
function timestamp(value: unknown): void {
  text(value);
  if (!Number.isFinite(Date.parse(value))) throw new Error("来源插件返回的时间无效");
}
function money(value: unknown): void {
  record(value); decimal(value.amount); text(value.currency);
}
function oneOf(value: unknown, allowed: readonly string[]): void {
  if (typeof value !== "string" || !allowed.includes(value)) throw new Error("来源插件返回的状态无效");
}
function nullableDecimal(value: unknown): void {
  if (value !== null) decimal(value);
}

/** 校验当前统一快照，不推导缺价、不补零，也不把明细加到平台权威总额。 */
export function assertPluginSnapshot(value: unknown): asserts value is AssetSnapshot {
  record(value); money(value.total); timestamp(value.syncedAt);
  if (value.longbridgeValuation !== undefined) {
    const valuation = value.longbridgeValuation; record(valuation);
    oneOf(valuation.basis, ["latest-quotes", "reported"]);
    money(valuation.reportedTotal);
    if (valuation.reportedAt !== null) timestamp(valuation.reportedAt);
  }
  if (!Array.isArray(value.holdings) || !Array.isArray(value.exchangeRates)) throw new Error("来源插件快照列表无效");
  for (const holding of value.holdings) {
    record(holding); text(holding.symbol); text(holding.name); text(holding.currency); decimal(holding.quantity);
    oneOf(holding.assetClass, ["securities", "crypto", "cash"]);
    for (const field of ["marketValue", "costPrice", "platformProfit", "changePercent"]) nullableDecimal(holding[field]);
    for (const field of ["currentPrice", "sourceMarketValue"]) if (holding[field] !== null) money(holding[field]);
    if (holding.previousClose !== undefined && holding.previousClose !== null) money(holding.previousClose);
    record(holding.valuation);
    oneOf(holding.valuation.status, ["valued", "unvalued", "quote-unavailable"]);
    if (holding.valuation.status === "valued") {
      text(holding.valuation.priceSource); timestamp(holding.valuation.pricedAt);
    } else text(holding.valuation.reason);
    for (const field of ["sourceAsset", "sourceProduct", "providerPositionId", "providerPositionState", "economicAssetKey", "costPriceSource"]) {
      if (holding[field] !== undefined) text(holding[field]);
    }
    if (holding.sourceAccount !== undefined) oneOf(holding.sourceAccount, ["spot", "wallet", "trading-bot", "funding", "earn-flexible", "earn-locked", "earn", "staking"]);
    if (holding.positionState !== undefined) oneOf(holding.positionState, ["active", "settling", "redeeming", "settled", "unknown"]);
    if (holding.providerPositionAvailableOn !== undefined) {
      text(holding.providerPositionAvailableOn);
      const day = holding.providerPositionAvailableOn;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) throw new Error("来源插件持仓日期无效");
    }
    if (holding.cashBalances !== undefined) {
      if (!Array.isArray(holding.cashBalances)) throw new Error("来源插件现金明细无效");
      for (const balance of holding.cashBalances) {
        record(balance); text(balance.currency);
        for (const field of ["amount", "availableCash", "frozenCash", "settlingCash", "withdrawCash"]) decimal(balance[field]);
      }
    }
    if (holding.quoteEvidence !== undefined) {
      const quote = holding.quoteEvidence; record(quote);
      oneOf(quote.session, ["regular", "pre-market", "post-market", "overnight", "unknown", "crypto-24h"]);
      oneOf(quote.freshness, ["current", "retained", "unavailable"]);
      oneOf(quote.delivery, ["realtime", "delayed", "unknown"]);
      timestamp(quote.observedAt); if (quote.quotedAt !== null) timestamp(quote.quotedAt);
      record(quote.provider); text(quote.provider.name);
      if (quote.provider.tradeStatus !== null) text(quote.provider.tradeStatus);
    }
  }
  for (const rate of value.exchangeRates) {
    record(rate); text(rate.baseCurrency); text(rate.quoteCurrency); text(rate.source); decimal(rate.rate); timestamp(rate.observedAt);
    if (decimalCompare(rate.rate, "0") <= 0) throw new Error("来源插件汇率必须大于零");
  }
  if (value.coverage !== undefined) {
    const coverage = value.coverage; record(coverage);
    oneOf(coverage.status, ["complete", "partial", "unknown"]);
    if (coverage.totalIsAuthoritative !== undefined && typeof coverage.totalIsAuthoritative !== "boolean") throw new Error("来源插件总额权威声明无效");
    if (coverage.unexplainedValue !== null) money(coverage.unexplainedValue);
    if (!Array.isArray(coverage.products) || !Array.isArray(coverage.excludedPositiveAccounts)) throw new Error("来源插件覆盖列表无效");
    coverage.excludedPositiveAccounts.forEach(text);
    for (const product of coverage.products) {
      record(product); text(product.product);
      oneOf(product.capability, ["detailed", "aggregate-only", "indirect", "unsupported", "unknown"]);
      oneOf(product.freshness, ["current", "expired"]);
      if (product.message !== null) text(product.message);
    }
  }
  if (value.unrecognizedEvmTokens !== undefined) {
    if (!Array.isArray(value.unrecognizedEvmTokens)) throw new Error("来源插件未知代币列表无效");
    for (const token of value.unrecognizedEvmTokens) {
      record(token); text(token.sourceAsset); text(token.reason); nullableDecimal(token.quantity);
      if (token.symbol !== null) text(token.symbol);
      if (token.name !== null) text(token.name);
    }
  }
}
