import { randomUUID } from "node:crypto";
import { decimalAdd, decimalCompare, decimalMultiply, decimalSubtract } from "@/domain/decimal";
import { activeSourceHoldings } from "@/domain/evm-token-preferences";
import {
  buildTotalValuation,
  convertCurrencyAmount,
} from "@/domain/valuation";
import type {
  AssetExchangeRate,
  AssetHolding,
  AssetSnapshot,
  AssetSourceRefresher,
  AssetSourceSummary,
  AssetSources,
  Clock,
  FormalDailySettlement,
  FormalDailySettlementRunner,
  FormalSettlementRunResult,
  FormalDailySettlements,
  FormalSettlementAnchor,
  FormalSettlementCandleReader,
  FormalSettlementDailyCandle,
  FormalSettlementHolding,
  FormalSettlementSource,
  FormalSettlementSourceCapture,
  FormalSettlementTradingCalendar,
  MarketTradingDays,
  SecretStore,
  SecuritiesMarket,
} from "@/server/ports";
import { isLongbridgeExternalReference } from "@/server/asset-sources/longbridge-connection";
import { LongbridgeTradingCalendar } from "@/server/asset-sources/longbridge-trading-calendar";

const FORMAL_SETTLEMENT_CAPTURE_WINDOW_MS = 2 * 60 * 60_000;

const MARKET_DETAILS: Record<
  SecuritiesMarket,
  { timeZone: string; closeHour: number; closeMinute: number; halfCloseHour?: number; priority: number }
> = {
  US: {
    timeZone: "America/New_York",
    closeHour: 16,
    closeMinute: 0,
    halfCloseHour: 13,
    priority: 5,
  },
  SG: {
    timeZone: "Asia/Singapore",
    closeHour: 17,
    // SGX closing price is fixed at the end of its six-minute closing routine.
    closeMinute: 6,
    halfCloseHour: 12,
    priority: 4,
  },
  HK: {
    timeZone: "Asia/Hong_Kong",
    closeHour: 16,
    // Wait through HKEX's closing auction (random close by :10).
    closeMinute: 10,
    halfCloseHour: 12,
    priority: 3,
  },
  SH: {
    timeZone: "Asia/Shanghai",
    closeHour: 15,
    closeMinute: 0,
    priority: 2,
  },
  SZ: {
    timeZone: "Asia/Shanghai",
    closeHour: 15,
    closeMinute: 0,
    priority: 2,
  },
};

type SecurityCandidate = {
  source: AssetSourceSummary;
  holding: AssetHolding;
  market: SecuritiesMarket;
};

type CapturedSource = {
  source: AssetSourceSummary;
  snapshot: AssetSnapshot | null;
  diagnostic: string | null;
};

type ConfirmedClose = SecurityCandidate & {
  candle: FormalSettlementDailyCandle;
  tradingDay: string;
};

function localDateParts(value: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
    second: part("second"),
  };
}

function localDay(value: Date, timeZone: string): string {
  const { year, month, day } = localDateParts(value, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function offsetAt(value: Date, timeZone: string): number {
  const parts = localDateParts(value, timeZone);
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  ) - value.getTime();
}

function zonedDateTime(
  day: string,
  timeZone: string,
  hour: number,
  minute: number,
): Date {
  const [year, month, date] = day.split("-").map(Number);
  const base = Date.UTC(year, month - 1, date, hour, minute);
  let value = new Date(base - offsetAt(new Date(base), timeZone));
  value = new Date(base - offsetAt(value, timeZone));
  return value;
}

function marketForSymbol(symbol: string): SecuritiesMarket | null {
  const match = /\.([A-Za-z]+)$/.exec(symbol);
  const suffix = match?.[1]?.toUpperCase();
  return suffix === "US" || suffix === "HK" || suffix === "SH" ||
      suffix === "SZ" || suffix === "SG"
    ? suffix
    : null;
}

function holdingKey(sourceId: string, holding: Pick<AssetHolding, "symbol" | "sourceAsset">): string {
  return `${sourceId}:${holding.sourceAsset ?? holding.symbol}`;
}

function securityCandidates(sources: AssetSourceSummary[]): SecurityCandidate[] {
  return sources.flatMap((source) =>
    source.kind !== "longbridge"
      ? []
      : activeSourceHoldings(source).flatMap((holding) => {
          if (holding.assetClass !== "securities" || decimalCompare(holding.quantity, "0") === 0) {
            return [];
          }
          const market = marketForSymbol(holding.symbol);
          return market ? [{ source, holding, market }] : [];
        }),
  );
}

function hasUnsupportedSecurities(sources: AssetSourceSummary[]): boolean {
  return sources.some((source) =>
    activeSourceHoldings(source).some(
      (holding) =>
        holding.assetClass === "securities" &&
        decimalCompare(holding.quantity, "0") !== 0 &&
        (source.kind !== "longbridge" || marketForSymbol(holding.symbol) === null),
    ),
  );
}

function marketClose(day: string, market: SecuritiesMarket, calendar: MarketTradingDays): Date {
  const details = MARKET_DETAILS[market];
  const halfDay = calendar.halfTradingDays.includes(day);
  if (halfDay && details.halfCloseHour === undefined) {
    throw new Error("无法确认该市场半日市收盘时间");
  }
  return zonedDateTime(day, details.timeZone, halfDay ? details.halfCloseHour! : details.closeHour, details.closeMinute);
}

async function anchorForSecurities(
  now: Date,
  securities: SecurityCandidate[],
  reader: FormalSettlementTradingCalendar,
): Promise<{ anchor: FormalSettlementAnchor | null; calendars: Map<SecuritiesMarket, MarketTradingDays> }> {
  const markets = [...new Set(securities.map((security) => security.market))]
    .toSorted((left, right) =>
      MARKET_DETAILS[right].priority - MARKET_DETAILS[left].priority ||
      left.localeCompare(right),
    );
  // One cycle uses the date in the latest-closing held market, even while Asia
  // has crossed midnight. On that market's holiday, another held market can anchor it.
  const tradingDay = localDay(now, MARKET_DETAILS[markets[0]!].timeZone);
  const start = new Date(Date.parse(tradingDay) - 28 * 86_400_000).toISOString().slice(0, 10);
  const calendars = new Map(await Promise.all(markets.map(async market => [
    market, await reader.readTradingDays({ market, start, end: tradingDay }),
  ] as const)));
  const candidates = markets.flatMap(market => {
    const calendar = calendars.get(market)!;
    if (!calendar.tradingDays.includes(tradingDay) && !calendar.halfTradingDays.includes(tradingDay)) return [];
    return [{ market, scheduledCloseAt: marketClose(tradingDay, market, calendar).toISOString() }];
  }).sort((left, right) => right.scheduledCloseAt.localeCompare(left.scheduledCloseAt));
  if (!candidates.length) return { anchor: null, calendars };
  const { market, scheduledCloseAt } = candidates[0];
  return { calendars, anchor: {
    key: `securities-close:${market}:${tradingDay}`,
    kind: "securities-close",
    market,
    tradingDay,
    scheduledCloseAt,
  } };
}

function cryptoCutoffAnchor(now: Date): FormalSettlementAnchor {
  const day = localDay(now, "Asia/Shanghai");
  return {
    key: `crypto-cutoff:${day}`,
    kind: "crypto-cutoff",
    market: null,
    tradingDay: day,
    scheduledCloseAt: zonedDateTime(day, "Asia/Shanghai", 0, 5).toISOString(),
  };
}

function expectedTradingDay(anchor: FormalSettlementAnchor, market: SecuritiesMarket, calendar: MarketTradingDays | undefined): string | null {
  if (!calendar) return null;
  return [...new Set([...calendar.tradingDays, ...calendar.halfTradingDays])]
    .filter(day => marketClose(day, market, calendar).getTime() <= Date.parse(anchor.scheduledCloseAt))
    .sort().at(-1) ?? null;
}

function sourceTotals(
  source: AssetSourceSummary,
  rateSources: AssetSourceSummary[],
): Record<"USD" | "CNY" | "HKD", string | null> {
  return {
    USD: buildTotalValuation([source], "USD", "source", rateSources).amount,
    CNY: buildTotalValuation([source], "CNY", "source", rateSources).amount,
    HKD: buildTotalValuation([source], "HKD", "source", rateSources).amount,
  };
}

function sourceIsComplete(
  source: AssetSourceSummary,
  rateSources: AssetSourceSummary[],
): boolean {
  const usd = buildTotalValuation([source], "USD", "source", rateSources);
  const hkd = buildTotalValuation([source], "HKD", "source", rateSources);
  return (
    source.sync.status === "current" &&
    !usd.incomplete &&
    !hkd.incomplete &&
    usd.amount !== null &&
    hkd.amount !== null
  );
}

function settlementHolding(
  source: AssetSourceSummary,
  holding: AssetHolding,
  close: ConfirmedClose | undefined,
): FormalSettlementHolding {
  const price =
    holding.currentPrice === null
      ? null
      : {
          amount: holding.currentPrice.amount,
          currency: holding.currentPrice.currency,
        };
  return {
    sourceId: source.id,
    sourceAsset: holding.sourceAsset ?? null,
    symbol: holding.symbol,
    name: holding.name,
    quantity: holding.quantity,
    assetClass: holding.assetClass,
    price,
    priceBasis:
      close !== undefined
        ? "official-close"
        : price !== null && holding.valuation.status === "valued"
          ? "capture-time"
          : "unavailable",
    priceObservedAt:
      close?.candle.timestamp ??
      (holding.valuation.status === "valued" ? holding.valuation.pricedAt : null),
    market: close?.market ?? null,
    marketTradingDay: close?.tradingDay ?? null,
    marketValue: holding.marketValue,
    diagnostic:
      holding.valuation.status === "valued"
        ? null
        : holding.valuation.reason,
  };
}

function revalueSecurities(
  source: AssetSourceSummary,
  snapshot: AssetSnapshot,
  closes: Map<string, ConfirmedClose>,
  capturedAt: string,
): { snapshot: AssetSnapshot; diagnostics: string[] } {
  const diagnostics: string[] = [];
  let totalDelta = "0";
  const holdings = snapshot.holdings.map((holding) => {
    const close = closes.get(holdingKey(source.id, holding));
    if (!close) return holding;
    const price = { amount: close.candle.close, currency: holding.currency };
    const marketValue = decimalMultiply(holding.quantity, price.amount);
    const sourceMarketValue = convertCurrencyAmount(
      marketValue,
      price.currency,
      snapshot.total.currency,
      snapshot.exchangeRates,
    );
    if (sourceMarketValue === null || holding.sourceMarketValue === null) {
      diagnostics.push(`${holding.symbol} 缺少收盘价折算所需汇率或来源估值`);
      return {
        ...holding,
        currentPrice: price,
        marketValue,
        sourceMarketValue: null,
        valuation: {
          status: "unvalued" as const,
          reason: `${holding.symbol} 缺少收盘价折算所需汇率`,
        },
      };
    }
    totalDelta = decimalAdd(
      totalDelta,
      decimalSubtract(sourceMarketValue, holding.sourceMarketValue.amount),
    );
    return {
      ...holding,
      currentPrice: price,
      marketValue,
      sourceMarketValue: {
        amount: sourceMarketValue,
        currency: snapshot.total.currency,
      },
      valuation: {
        status: "valued" as const,
        priceSource: "Longbridge 官方日 K 常规盘收盘",
        pricedAt: close.candle.timestamp,
      },
    };
  });
  return {
    snapshot: {
      ...snapshot,
      total: {
        ...snapshot.total,
        amount: decimalAdd(snapshot.total.amount, totalDelta),
      },
      holdings,
      syncedAt: capturedAt,
    },
    diagnostics,
  };
}

function sourceWithSnapshot(
  source: AssetSourceSummary,
  snapshot: AssetSnapshot,
): AssetSourceSummary {
  return {
    ...source,
    snapshot,
    sync: {
      ...source.sync,
      status: "current",
      lastSuccessfulAt: snapshot.syncedAt,
      lastAttemptAt: snapshot.syncedAt,
      error: null,
      failedMode: null,
    },
  };
}

function formatDiagnostics(values: string[]): string | null {
  return values.length === 0 ? null : values.join("；");
}

/**
 * 只读取当次日结所需的来源快照。它不会更新实时快照，也不会触发每日趋势写入。
 */
export class ReadOnlyFormalSettlementSourceCapture
  implements FormalSettlementSourceCapture
{
  constructor(
    private readonly secrets: SecretStore,
    private readonly refresher: AssetSourceRefresher,
    private readonly timeoutMs = 60_000,
    private readonly assetSources?: AssetSources,
  ) {}

  async capture(input: {
    source: AssetSourceSummary;
    attemptedAt: string;
  }): Promise<AssetSnapshot> {
    const isPublicWatchWallet = input.source.kind.startsWith("evm-watch-");
    if (input.source.credentialReference === null && !isPublicWatchWallet) {
      throw new Error("只读凭证不可用");
    }
    const credentialReference = input.source.credentialReference;
    const usesKeychainReference =
      input.source.kind === "longbridge" &&
      credentialReference !== null &&
      isLongbridgeExternalReference(credentialReference);
    const guard = this.assetSources?.refreshGuard;
    const token = randomUUID();
    const lease = () => ({ sourceId: input.source.id, token, now: new Date().toISOString() });
    if (guard && !await guard.claim({ ...lease(), leaseMs: this.timeoutMs + 5_000 })) throw new Error("来源正在刷新，等待下次日结检查");
    const controller = new AbortController();
    const assertCurrent = async () => {
      controller.signal.throwIfAborted();
      if (guard && !await guard.owns(lease())) throw new Error("来源读取租约失效");
      if (this.assetSources) {
        const current = (await this.assetSources.list()).find(source => source.id === input.source.id);
        if (!current || current.lifecycle === "disconnected" || current.kind !== input.source.kind ||
            current.accountId !== input.source.accountId || current.credentialReference !== credentialReference) throw new Error("来源连接已变化");
      }
    };
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
          (async () => {
            await assertCurrent();
            const credentials = credentialReference === null ? "" : usesKeychainReference
              ? credentialReference : await this.secrets.get(credentialReference);
            if (credentials === null) throw new Error("只读凭证不可用");
            controller.signal.throwIfAborted();
            return this.refresher.refresh({
            source: input.source,
            credentials,
            mode: "all",
            attemptedAt: input.attemptedAt,
            signal: controller.signal,
            persistCredentials: usesKeychainReference || credentialReference === null
              ? () => Promise.resolve()
              : async (value) => {
                await assertCurrent();
                controller.signal.throwIfAborted();
                await this.secrets.replace(credentialReference, value);
              },
            });
          })(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => {
              controller.abort();
              reject(new Error(`日结来源读取超时（${this.timeoutMs}ms）`));
            }, this.timeoutMs);
          }),
        ]);
      await assertCurrent();
      return result.snapshot;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      controller.abort();
      if (guard) await guard.release(lease());
    }
  }
}

/**
 * 正式日结的独立应用服务：实时刷新与每日趋势都不参与其记录写入。
 */
export class MarketCloseFormalDailySettlement
  implements FormalDailySettlementRunner
{
  constructor(
    private readonly sources: AssetSources,
    private readonly clock: Clock,
    private readonly settlements: FormalDailySettlements,
    private readonly sourceCapture: FormalSettlementSourceCapture,
    private readonly candleReader: FormalSettlementCandleReader,
    private readonly captureWindowMs = FORMAL_SETTLEMENT_CAPTURE_WINDOW_MS,
    private readonly calendar: FormalSettlementTradingCalendar = new LongbridgeTradingCalendar(),
  ) {}

  async run(): Promise<FormalSettlementRunResult> {
    const now = this.clock.now();
    const attemptedAt = now.toISOString();
    const sources = (await this.sources.list()).filter(
      (source) =>
        source.lifecycle !== "disconnected" &&
        (source.kind !== "manual" || source.hasManualRecord !== false),
    );
    if (sources.length === 0) return { outcome: "not-due", reason: "no-sources" };
    const securities = securityCandidates(sources);
    let anchor: FormalSettlementAnchor;
    let calendars = new Map<SecuritiesMarket, MarketTradingDays>();
    if (securities.length > 0) {
      try {
        const schedule = await anchorForSecurities(now, securities, this.calendar);
        if (schedule.anchor === null) return { outcome: "not-due", reason: "market-closed" };
        anchor = schedule.anchor;
        calendars = schedule.calendars;
      } catch {
        return { outcome: "error", reason: "calendar-read-failed" };
      }
    } else {
      anchor = cryptoCutoffAnchor(now);
    }
    const existing = (await this.settlements.list()).find(
      (settlement) => settlement.anchor.key === anchor.key,
    );
    if (existing) return { outcome: "already-recorded", settlementStatus: existing.status };

    const scheduledAt = Date.parse(anchor.scheduledCloseAt);
    if (now.getTime() < scheduledAt) return { outcome: "not-due", reason: "before-window" };
    if (now.getTime() > scheduledAt + this.captureWindowMs) {
      return this.recordIfAbsent({
        anchor,
        capturedAt: null,
        status: "missed",
        diagnostic: "采集窗口内未形成正式日结，未使用之后的实时数据补写",
        total: { USD: null, CNY: null, HKD: null },
        exchangeRates: [],
        sources: [],
        holdings: [],
      });
    }

    if (hasUnsupportedSecurities(sources)) {
      return this.recordIfAbsent({
        anchor,
        capturedAt: attemptedAt,
        status: "incomplete",
        diagnostic: "存在不能取得官方日 K 常规盘收盘的证券来源",
        total: { USD: null, CNY: null, HKD: null },
        exchangeRates: [],
        sources: [],
        holdings: [],
      });
    }

    const captures = await Promise.all(
      sources.map(async (source): Promise<CapturedSource> => {
        if (source.kind === "manual") {
          return {
            source,
            snapshot: source.snapshot,
            diagnostic: "手工资产没有同一采集窗口的可验证行情",
          };
        }
        try {
          return {
            source,
            snapshot: await this.sourceCapture.capture({ source, attemptedAt }),
            diagnostic: null,
          };
        } catch {
          return {
            source,
            snapshot: null,
            diagnostic: "日结来源读取失败",
          };
        }
      }),
    );

    const capturedBySourceId = new Map(
      captures
        .filter((capture): capture is CapturedSource & { snapshot: AssetSnapshot } =>
          capture.snapshot !== null,
        )
        .map((capture) => [capture.source.id, capture]),
    );
    const capturedSecurities = securityCandidates(
      captures.flatMap((capture) =>
        capture.snapshot === null
          ? []
          : [sourceWithSnapshot(capture.source, capture.snapshot)],
      ),
    );
    // A fresh capture can include a market absent from the persisted snapshot.
    // Confirm that market's calendar and close before accepting its daily candle.
    if (capturedSecurities.some(security => !calendars.has(security.market))) {
      try {
        const schedule = await anchorForSecurities(now, [...securities, ...capturedSecurities], this.calendar);
        if (schedule.anchor === null) return { outcome: "not-due", reason: "market-closed" };
        anchor = schedule.anchor;
        calendars = schedule.calendars;
      } catch {
        return { outcome: "error", reason: "calendar-read-failed" };
      }
      if (now.getTime() < Date.parse(anchor.scheduledCloseAt)) {
        return { outcome: "not-due", reason: "before-window" };
      }
      const recorded = (await this.settlements.list()).find(value => value.anchor.key === anchor.key);
      if (recorded) return { outcome: "already-recorded", settlementStatus: recorded.status };
      if (now.getTime() > Date.parse(anchor.scheduledCloseAt) + this.captureWindowMs) {
        return this.recordIfAbsent({
          anchor,
          capturedAt: null,
          status: "missed",
          diagnostic: "采集窗口内未形成正式日结，未使用之后的实时数据补写",
          total: { USD: null, CNY: null, HKD: null },
          exchangeRates: [],
          sources: [],
          holdings: [],
        });
      }
    }
    const closeErrors: string[] = [];
    let candleReadFailed = false;
    const confirmedCloses = new Map<string, ConfirmedClose>();
    const securitiesBySource = new Map<string, SecurityCandidate[]>();
    for (const security of capturedSecurities) {
      securitiesBySource.set(security.source.id, [
        ...(securitiesBySource.get(security.source.id) ?? []),
        security,
      ]);
    }
    await Promise.all(
      [...securitiesBySource.entries()].map(async ([sourceId, values]) => {
        const capture = capturedBySourceId.get(sourceId);
        if (!capture) return;
        try {
          const candles = await this.candleReader.readDailyCandles({
            source: capture.source,
            symbols: [...new Set(values.map(({ holding }) => holding.symbol))],
          });
          const candleBySymbol = new Map(candles.map((candle) => [candle.symbol, candle]));
          for (const security of values) {
            const candle = candleBySymbol.get(security.holding.symbol);
            const expectedDay = expectedTradingDay(anchor, security.market, calendars.get(security.market));
            const tradingDay = candle === undefined
              ? null
              : localDay(new Date(candle.timestamp), MARKET_DETAILS[security.market].timeZone);
            if (
              expectedDay === null || candle === undefined ||
              candle.tradeSession !== "intraday" ||
              tradingDay !== expectedDay
            ) {
              closeErrors.push(
                `${security.holding.symbol} 尚无 ${expectedDay ?? "交易日历确认日期"} 的官方日 K 常规盘收盘`,
              );
              continue;
            }
            confirmedCloses.set(holdingKey(security.source.id, security.holding), {
              ...security,
              candle,
              tradingDay,
            });
          }
        } catch {
          candleReadFailed = true;
        }
      }),
    );

    const captureErrors = captures.flatMap((capture) =>
      capture.snapshot === null
        ? [`${capture.source.label}：${capture.diagnostic ?? "日结来源读取失败"}`]
        : [],
    );
    if (captureErrors.length > 0) return { outcome: "error", reason: "source-read-failed" };
    if (candleReadFailed) return { outcome: "error", reason: "candle-read-failed" };
    if (closeErrors.length > 0) return { outcome: "waiting", reason: "official-close-pending" };

    const valuationSources = captures.flatMap((capture) => {
      if (capture.snapshot === null) return [];
      const revalued = revalueSecurities(
        capture.source,
        capture.snapshot,
        confirmedCloses,
        attemptedAt,
      );
      return [sourceWithSnapshot(capture.source, revalued.snapshot)];
    });
    const formalSources: FormalSettlementSource[] = [];
    const holdings: FormalSettlementHolding[] = [];
    const valuationDiagnostics: string[] = [];
    for (const capture of captures) {
      if (capture.snapshot === null) continue;
      const revalued = revalueSecurities(
        capture.source,
        capture.snapshot,
        confirmedCloses,
        attemptedAt,
      );
      const source = sourceWithSnapshot(capture.source, revalued.snapshot);
      const sourceDiagnostic = formatDiagnostics([
        ...(capture.diagnostic === null ? [] : [capture.diagnostic]),
        ...revalued.diagnostics,
      ]);
      const complete =
        sourceDiagnostic === null && sourceIsComplete(source, valuationSources);
      formalSources.push({
        sourceId: source.id,
        label: source.label,
        kind: source.kind,
        capturedAt: source.snapshot.syncedAt,
        status: complete ? "complete" : "incomplete",
        diagnostic: sourceDiagnostic,
        total: sourceTotals(source, valuationSources),
      });
      holdings.push(
        ...activeSourceHoldings(source).map((holding) =>
          settlementHolding(
            source,
            holding,
            confirmedCloses.get(holdingKey(source.id, holding)),
          ),
        ),
      );
      if (!complete) valuationDiagnostics.push(`${source.label} 估值不完整`);
    }
    for (const capture of captures.filter((capture) => capture.snapshot === null)) {
      formalSources.push({
        sourceId: capture.source.id,
        label: capture.source.label,
        kind: capture.source.kind,
        capturedAt: null,
        status: "incomplete",
        diagnostic: capture.diagnostic,
        total: { USD: null, CNY: null, HKD: null },
      });
    }
    const complete =
      formalSources.length === sources.length &&
      formalSources.every((source) => source.status === "complete");
    const usd = buildTotalValuation(valuationSources, "USD", "source");
    const cny = buildTotalValuation(valuationSources, "CNY", "source");
    const hkd = buildTotalValuation(valuationSources, "HKD", "source");
    const status = complete && !usd.incomplete && !cny.incomplete && !hkd.incomplete
      ? "complete"
      : "incomplete";
    const diagnostics = formatDiagnostics([
      ...valuationDiagnostics,
      ...(status === "complete" ? [] : ["存在未完整折算或来源证据"]),
    ]);
    return this.recordIfAbsent({
      anchor,
      capturedAt: attemptedAt,
      status,
      diagnostic: diagnostics,
      total: {
        USD: usd.amount,
        CNY: cny.amount,
        HKD: hkd.amount,
      },
      exchangeRates: usd.exchangeRateObservations,
      sources: formalSources,
      holdings,
    });
  }

  private async recordIfAbsent(
    settlement: FormalDailySettlement,
  ): Promise<FormalSettlementRunResult> {
    const recorded = await this.settlements.recordIfAbsent(settlement);
    const actual = recorded ? settlement : (await this.settlements.list()).find(
      (value) => value.anchor.key === settlement.anchor.key,
    );
    return {
      outcome: recorded ? "recorded" : "already-recorded",
      settlementStatus: actual?.status,
      ...(actual?.status === "missed" ? { reason: "capture-window-missed" as const } :
        actual?.status === "incomplete" ? { reason: "incomplete-evidence" as const } : {}),
    };
  }
}

export function settlementMarketForSymbol(symbol: string): SecuritiesMarket | null {
  return marketForSymbol(symbol);
}
