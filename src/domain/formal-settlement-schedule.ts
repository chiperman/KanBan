import type {
  FormalSettlementAnchor,
  MarketTradingDays,
  SecuritiesMarket,
} from "@/server/ports";

export const SETTLEMENT_MARKET_DETAILS: Record<
  SecuritiesMarket,
  {
    timeZone: string;
    closeHour: number;
    closeMinute: number;
    halfCloseHour?: number;
    priority: number;
  }
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

function localDateParts(
  value: Date,
  timeZone: string,
): {
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

export function localSettlementDay(value: Date, timeZone: string): string {
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

export function settlementMarketForSymbol(
  symbol: string,
): SecuritiesMarket | null {
  const match = /\.([A-Za-z]+)$/.exec(symbol);
  const suffix = match?.[1]?.toUpperCase();
  return suffix === "US" || suffix === "HK" || suffix === "SH" ||
      suffix === "SZ" || suffix === "SG"
    ? suffix
    : null;
}

function marketClose(
  day: string,
  market: SecuritiesMarket,
  calendar: MarketTradingDays,
): Date {
  const details = SETTLEMENT_MARKET_DETAILS[market];
  const halfDay = calendar.halfTradingDays.includes(day);
  if (halfDay && details.halfCloseHour === undefined) {
    throw new Error("无法确认该市场半日市收盘时间");
  }
  return zonedDateTime(
    day,
    details.timeZone,
    halfDay ? details.halfCloseHour! : details.closeHour,
    details.closeMinute,
  );
}

export async function anchorForSecurities(
  now: Date,
  securities: readonly { market: SecuritiesMarket }[],
  reader: {
    readTradingDays(input: {
      market: SecuritiesMarket;
      start: string;
      end: string;
    }): Promise<MarketTradingDays>;
  },
): Promise<{
  anchor: FormalSettlementAnchor | null;
  calendars: Map<SecuritiesMarket, MarketTradingDays>;
}> {
  const markets = [...new Set(securities.map((security) => security.market))]
    .toSorted((left, right) =>
      SETTLEMENT_MARKET_DETAILS[right].priority -
      SETTLEMENT_MARKET_DETAILS[left].priority ||
      left.localeCompare(right),
    );
  // One cycle uses the date in the latest-closing held market, even while Asia
  // has crossed midnight. On that market's holiday, another held market can anchor it.
  const tradingDay = localSettlementDay(
    now,
    SETTLEMENT_MARKET_DETAILS[markets[0]!].timeZone,
  );
  const start = new Date(Date.parse(tradingDay) - 28 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const calendars = new Map(await Promise.all(markets.map(async (market) => [
    market,
    await reader.readTradingDays({ market, start, end: tradingDay }),
  ] as const)));
  const candidates = markets.flatMap((market) => {
    const calendar = calendars.get(market)!;
    if (
      !calendar.tradingDays.includes(tradingDay) &&
      !calendar.halfTradingDays.includes(tradingDay)
    ) return [];
    return [{
      market,
      scheduledCloseAt: marketClose(tradingDay, market, calendar)
        .toISOString(),
    }];
  }).sort((left, right) =>
    right.scheduledCloseAt.localeCompare(left.scheduledCloseAt),
  );
  if (!candidates.length) return { anchor: null, calendars };
  const { market, scheduledCloseAt } = candidates[0];
  return {
    calendars,
    anchor: {
      key: `securities-close:${market}:${tradingDay}`,
      kind: "securities-close",
      market,
      tradingDay,
      scheduledCloseAt,
    },
  };
}

export function cryptoCutoffAnchor(now: Date): FormalSettlementAnchor {
  const day = localSettlementDay(now, "Asia/Shanghai");
  return {
    key: `crypto-cutoff:${day}`,
    kind: "crypto-cutoff",
    market: null,
    tradingDay: day,
    scheduledCloseAt: zonedDateTime(day, "Asia/Shanghai", 0, 5)
      .toISOString(),
  };
}

export function expectedTradingDay(
  anchor: FormalSettlementAnchor,
  market: SecuritiesMarket,
  calendar: MarketTradingDays | undefined,
): string | null {
  if (!calendar) return null;
  return [...new Set([
    ...calendar.tradingDays,
    ...calendar.halfTradingDays,
  ])]
    .filter((day) =>
      marketClose(day, market, calendar).getTime() <=
      Date.parse(anchor.scheduledCloseAt)
    )
    .sort().at(-1) ?? null;
}
