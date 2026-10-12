/** 外部账户被允许读取的能力；生产适配器不得据此发起写操作。 */
export type AssetPermission =
  | "market-data"
  | "public-address"
  | "account"
  | "positions"
  | "trade"
  | "transfer"
  | "withdraw";

export interface AssetMoney {
  amount: string;
  currency: string;
}

export interface AssetCashBalance {
  amount: string;
  availableCash: string;
  currency: string;
  frozenCash: string;
  settlingCash: string;
  withdrawCash: string;
}

export type AssetClass = "securities" | "crypto" | "cash";
export type ManualAssetClass = AssetClass | "other";

export type AssetPositionState =
  | "active"
  | "settling"
  | "redeeming"
  | "settled"
  | "unknown";

export type AssetCoverageCapability =
  | "detailed"
  | "aggregate-only"
  | "indirect"
  | "unsupported"
  | "unknown";

export interface AssetProductCoverage {
  product: string;
  capability: AssetCoverageCapability;
  freshness: "current" | "expired";
  message: string | null;
}

export interface AssetSnapshotCoverage {
  status: "complete" | "partial" | "unknown";
  /**
   * 平台账户总额可作为总资产的权威依据；持仓明细差额仅用于对账提示。
   * 缺省为 false，以兼容不能证明平台总额覆盖范围的旧快照。
   */
  totalIsAuthoritative?: boolean;
  products: AssetProductCoverage[];
  unexplainedValue: AssetMoney | null;
  excludedPositiveAccounts: string[];
}

export interface AssetExchangeRate {
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  source: string;
  observedAt: string;
}

export type AssetValuation =
  | {
      status: "valued";
      priceSource: string;
      pricedAt: string;
    }
  | {
      status: "unvalued";
      reason: string;
    }
  | {
      /** 来源账户总额已包含该持仓，但持仓级行情因来源能力限制不可用。 */
      status: "quote-unavailable";
      reason: string;
    };

export type AssetQuoteSession =
  | "regular"
  | "pre-market"
  | "post-market"
  | "overnight"
  | "unknown"
  | "crypto-24h";

/** 当前价格的供应商时段与时间证据；旧快照可缺省。 */
export interface AssetQuoteEvidence {
  session: AssetQuoteSession;
  /** 供应商给出的成交/报价时间；绝不使用同步完成时间填充。 */
  quotedAt: string | null;
  /** KanBan 成功读取该供应商响应的时间，仅供诊断。 */
  observedAt: string;
  freshness: "current" | "retained" | "unavailable";
  /** 未得到供应商或已知请求规则直接证明时，必须为 unknown。 */
  delivery: "realtime" | "delayed" | "unknown";
  provider: {
    name: string;
    tradeStatus: string | null;
  };
}

export interface AssetHolding {
  symbol: string;
  name: string;
  /** 来源内资产标识与账户分区；用于同一资产跨分区保持独立。 */
  sourceAsset?: string;
  sourceAccount?:
    | "spot"
    | "wallet"
    | "trading-bot"
    | "funding"
    | "earn-flexible"
    | "earn-locked"
    | "earn"
    | "staking";
  /** 来源产品身份与仓位证据；旧快照可缺省。 */
  sourceProduct?: string;
  providerPositionId?: string;
  providerPositionState?: string;
  /** 来源明确给出的最早可领取日期，格式为 YYYY-MM-DD。 */
  providerPositionAvailableOn?: string;
  economicAssetKey?: string;
  positionState?: AssetPositionState;
  quantity: string;
  currency: string;
  assetClass: AssetClass;
  /** 现金汇总持仓的来源原生币种拆分；总资产仍只计该持仓一次。 */
  cashBalances?: AssetCashBalance[];
  currentPrice: AssetMoney | null;
  /** 当前价格的会话证据；缺省时 UI 按未知时段兼容旧快照。 */
  quoteEvidence?: AssetQuoteEvidence;
  /** 用于按来源上一交易日收盘价计算当日持仓盈亏；旧快照可缺省。 */
  previousClose?: AssetMoney | null;
  marketValue: string | null;
  /** 来源按账户计价货币给出的可比较市值，仅用于来源内排序与汇总。 */
  sourceMarketValue: AssetMoney | null;
  valuation: AssetValuation;
  costPrice: string | null;
  /** 成本价的计算或来源口径；旧快照可缺省。 */
  costPriceSource?: string;
  platformProfit: string | null;
  changePercent: string | null;
}

/** 已发现正余额但无法按 ERC-20 规则读取数量的 EVM 合约。 */
export interface EvmUnrecognizedToken {
  sourceAsset: string;
  symbol: string | null;
  name: string | null;
  /** 合约不返回可靠 decimals 时不能伪造数量。 */
  quantity: string | null;
  reason: string;
}

export interface AssetSnapshot {
  total: AssetMoney;
  holdings: AssetHolding[];
  /** 仅 EVM 观察钱包使用；不计入来源总额，供所有者决定关注或忽略。 */
  unrecognizedEvmTokens?: EvmUnrecognizedToken[];
  exchangeRates: AssetExchangeRate[];
  syncedAt: string;
  /** 可选以兼容旧快照；缺省表示尚未证明产品覆盖范围。 */
  coverage?: AssetSnapshotCoverage;
}
