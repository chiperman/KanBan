import {
  decimalAdd,
  decimalCompare,
  decimalDivide,
  decimalMultiply,
  decimalSubtract,
} from "@/domain/decimal";
import { convertCurrencyAmount } from "@/domain/valuation";
import type {
  AssetExchangeRate,
  AssetSnapshot,
  InvestmentCashflow,
  InvestmentCashflowCurrency,
  InvestmentCashflowInput,
} from "@/server/ports";

export type InvestmentCashflowRateSource = {
  kind: string;
  snapshot: Pick<AssetSnapshot, "exchangeRates">;
};

export interface InvestmentCashflowValuation {
  amounts: Record<InvestmentCashflowCurrency, string | null>;
  exchangeRates: AssetExchangeRate[];
}

export interface PortfolioObservation {
  amount: string;
  complete: boolean;
  observedAt: string;
}

export interface InvestmentPerformanceAnalysis {
  current: {
    cumulativeNetInvestment: string | null;
    investmentProfit: string | null;
  };
  interval: {
    assetChange: string | null;
    netExternalCashflow: string | null;
    investmentProfit: string | null;
    investmentProfitRatio: string | null;
  };
}

const SUPPORTED_CURRENCIES = new Set<InvestmentCashflowCurrency>([
  "USD",
  "CNY",
  "HKD",
]);

const LONG_BRIDGE_PAIRS: ReadonlyArray<
  readonly ["USD", "CNY" | "HKD"]
> = [
  ["USD", "CNY"],
  ["USD", "HKD"],
];

function asDate(value: string, label: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new Error(`${label}必须是有效 ISO 时间`);
  return parsed;
}

function assertPositiveDecimal(value: string, label: string): void {
  if (!/^(?:0|[1-9]\d{0,17})(?:\.\d{1,8})?$/.test(value)) {
    throw new Error(`${label}格式无效`);
  }
  if (decimalCompare(value, "0") <= 0) throw new Error(`${label}必须大于零`);
}

export function normalizeInvestmentCashflowInput(
  input: InvestmentCashflowInput,
): InvestmentCashflowInput {
  if (
    input.kind !== "initial-investment" &&
    input.kind !== "external-deposit" &&
    input.kind !== "external-withdrawal"
  ) {
    throw new Error("资金类型无效");
  }
  if (!SUPPORTED_CURRENCIES.has(input.currency)) {
    throw new Error("资金币种仅支持 USD、CNY 或 HKD");
  }
  assertPositiveDecimal(input.amount, "资金金额");
  const occurredAt = asDate(input.occurredAt, "资金发生时间").toISOString();
  if (
    input.note !== null &&
    (typeof input.note !== "string" ||
      input.note.length > 500 ||
      /[\u0000-\u001f\u007f]/.test(input.note))
  ) {
    throw new Error("资金备注格式无效");
  }
  return {
    ...input,
    occurredAt,
    amount: input.amount,
    note: input.note === null ? null : input.note.trim() || null,
  };
}

function validRate(rate: AssetExchangeRate): boolean {
  return (
    typeof rate.source === "string" &&
    rate.source.trim().length > 0 &&
    typeof rate.observedAt === "string" &&
    !Number.isNaN(new Date(rate.observedAt).valueOf()) &&
    /^\d+(?:\.\d+)?$/.test(rate.rate) &&
    decimalCompare(rate.rate, "0") > 0
  );
}

function rateMatchesPair(
  rate: AssetExchangeRate,
  baseCurrency: string,
  quoteCurrency: string,
): boolean {
  return (
    (rate.baseCurrency === baseCurrency && rate.quoteCurrency === quoteCurrency) ||
    (rate.baseCurrency === quoteCurrency && rate.quoteCurrency === baseCurrency)
  );
}

/**
 * 全局本金账本只使用长桥来源产生的 USD/CNY、USD/HKD 参考汇率；
 * 不因为其他平台也返回汇率而改变历史资金的计价证据。
 */
export function longbridgeReferenceRates(
  sources: InvestmentCashflowRateSource[],
): AssetExchangeRate[] {
  const available = sources
    .filter((source) => source.kind === "longbridge")
    .flatMap((source) => source.snapshot.exchangeRates)
    .filter(validRate);
  return LONG_BRIDGE_PAIRS.flatMap(([baseCurrency, quoteCurrency]) => {
    const matches = available
      .filter((rate) => rateMatchesPair(rate, baseCurrency, quoteCurrency))
      .toSorted((left, right) =>
        right.observedAt.localeCompare(left.observedAt),
      );
    return matches[0] === undefined ? [] : [matches[0]];
  });
}

export function valueInvestmentCashflow(
  input: InvestmentCashflowInput,
  rateSources: InvestmentCashflowRateSource[],
): InvestmentCashflowValuation {
  const normalized = normalizeInvestmentCashflowInput(input);
  const exchangeRates = longbridgeReferenceRates(rateSources);
  const amounts = (["USD", "CNY", "HKD"] as const).reduce(
    (current, currency) => {
      current[currency] = convertCurrencyAmount(
        normalized.amount,
        normalized.currency,
        currency,
        exchangeRates,
      );
      return current;
    },
    {} as Record<InvestmentCashflowCurrency, string | null>,
  );
  return { amounts, exchangeRates };
}

function signedCashflowAmount(
  cashflow: InvestmentCashflow,
  currency: InvestmentCashflowCurrency,
): string | null {
  const amount = cashflow.amounts[currency];
  if (amount === null) return null;
  return cashflow.kind === "external-withdrawal" ? `-${amount}` : amount;
}

function sumCashflows(
  cashflows: InvestmentCashflow[],
  currency: InvestmentCashflowCurrency,
): string | null {
  const amounts = cashflows.map((cashflow) =>
    signedCashflowAmount(cashflow, currency),
  );
  return amounts.some((amount) => amount === null)
    ? null
    : decimalAdd(...(amounts as string[]));
}

function completeObservation(observation: PortfolioObservation): boolean {
  return (
    observation.complete &&
    !Number.isNaN(new Date(observation.observedAt).valueOf())
  );
}

function cashflowsWithin(
  cashflows: InvestmentCashflow[],
  startExclusive: string,
  endInclusive: string,
): InvestmentCashflow[] {
  const start = new Date(startExclusive).valueOf();
  const end = new Date(endInclusive).valueOf();
  return cashflows.filter((cashflow) => {
    const occurredAt = new Date(cashflow.occurredAt).valueOf();
    return occurredAt > start && occurredAt <= end;
  });
}

export function assertInvestmentCashflowSequence(
  cashflows: InvestmentCashflow[],
): void {
  const initials = cashflows.filter(
    ({ kind }) => kind === "initial-investment",
  );
  if (initials.length > 1) throw new Error("初始投入只能保留一条");
  const initial = initials[0];
  if (!initial) return;
  const initialAt = new Date(initial.occurredAt).valueOf();
  if (
    cashflows.some(
      (cashflow) =>
        cashflow.id !== initial.id &&
        new Date(cashflow.occurredAt).valueOf() < initialAt,
    )
  ) {
    throw new Error("初始投入必须是最早的资金记录");
  }
}

export function analyzeInvestmentPerformance(input: {
  currency: InvestmentCashflowCurrency;
  asOf: string;
  currentTotal: PortfolioObservation | null;
  cashflows: InvestmentCashflow[];
  interval: { start: PortfolioObservation; end: PortfolioObservation } | null;
}): InvestmentPerformanceAnalysis {
  const asOf = asDate(input.asOf, "分析截止时间").valueOf();
  const cashflowsBeforeAsOf = input.cashflows.filter(
    (cashflow) => new Date(cashflow.occurredAt).valueOf() <= asOf,
  );
  const hasInitialInvestment = cashflowsBeforeAsOf.some(
    (cashflow) => cashflow.kind === "initial-investment",
  );
  const cumulativeNetInvestment = hasInitialInvestment
    ? sumCashflows(cashflowsBeforeAsOf, input.currency)
    : null;

  const current = input.currentTotal;
  const currentCanCalculate =
    current !== null &&
    completeObservation(current) &&
    new Date(current.observedAt).valueOf() <= asOf &&
    cumulativeNetInvestment !== null;
  const currentProfit = currentCanCalculate
    ? decimalSubtract(current.amount, cumulativeNetInvestment)
    : null;

  if (
    input.interval === null ||
    !completeObservation(input.interval.start) ||
    !completeObservation(input.interval.end)
  ) {
    return {
      current: {
        cumulativeNetInvestment,
        investmentProfit: currentProfit,
      },
      interval: {
        assetChange: null,
        netExternalCashflow: null,
        investmentProfit: null,
        investmentProfitRatio: null,
      },
    };
  }

  const startAt = new Date(input.interval.start.observedAt).valueOf();
  const endAt = new Date(input.interval.end.observedAt).valueOf();
  if (endAt <= startAt) {
    return {
      current: {
        cumulativeNetInvestment,
        investmentProfit: currentProfit,
      },
      interval: {
        assetChange: null,
        netExternalCashflow: null,
        investmentProfit: null,
        investmentProfitRatio: null,
      },
    };
  }

  const assetChange = decimalSubtract(
    input.interval.end.amount,
    input.interval.start.amount,
  );
  const intervalCashflows = cashflowsWithin(
    input.cashflows,
    input.interval.start.observedAt,
    input.interval.end.observedAt,
  );
  const netExternalCashflow = sumCashflows(intervalCashflows, input.currency);
  if (netExternalCashflow === null) {
    return {
      current: {
        cumulativeNetInvestment,
        investmentProfit: currentProfit,
      },
      interval: {
        assetChange,
        netExternalCashflow: null,
        investmentProfit: null,
        investmentProfitRatio: null,
      },
    };
  }

  const investmentProfit = decimalSubtract(assetChange, netExternalCashflow);
  const weightedCashflow = intervalCashflows.reduce((sum, cashflow) => {
    const amount = signedCashflowAmount(cashflow, input.currency);
    if (amount === null) return null;
    if (sum === null) return null;
    const weight = decimalDivide(
      String(endAt - new Date(cashflow.occurredAt).valueOf()),
      String(endAt - startAt),
    );
    return decimalAdd(sum, decimalMultiply(amount, weight));
  }, "0" as string | null);
  const denominator = weightedCashflow === null
    ? null
    : decimalAdd(input.interval.start.amount, weightedCashflow);
  const investmentProfitRatio =
    denominator === null || decimalCompare(denominator, "0") <= 0
      ? null
      : decimalDivide(investmentProfit, denominator);

  return {
    current: {
      cumulativeNetInvestment,
      investmentProfit: currentProfit,
    },
    interval: {
      assetChange,
      netExternalCashflow,
      investmentProfit,
      investmentProfitRatio,
    },
  };
}
