/**
 * 系统边界端口：时间、卡片存储、外部资产来源、价格、身份认证、安全存储。
 * 测试环境通过替换这些端口注入测试替身；生产组合根不引用任何替身实现。
 */

export interface Clock {
  now(): Date;
}

export type CardSpan = 1 | 2 | 3;

export interface AssetCard {
  id: string;
  kind: "asset";
  title: string;
  body: string;
  sourceId?: string;
  hidden?: boolean;
  span: CardSpan;
  /** 从新行开始，避免自动网格填补上一行的空位。 */
  startsNewRow?: boolean;
}

export type Card = AssetCard;

export interface AssetCardStore {
  list(): Promise<Card[]>;
  replaceAll(cards: Card[]): Promise<void>;
}

export interface AssetSourceSummary {
  id: string;
  kind: string;
  label: string;
  /** 所有者设置的可选展示名；缺省时使用平台默认名称。 */
  displayName?: string;
  accountId: string;
  permissions: AssetPermission[];
  /** 断开来源可不再持有任何凭证引用；连接来源必须为非空引用。 */
  credentialReference: string | null;
  snapshot: AssetSnapshot;
  sync: AssetSourceSyncState;
  /** 所有者按 EVM chain ID + contract address 明确忽略的来源资产标识。 */
  ignoredAssetKeys?: string[];
  /** 所有者确认属于投资资产、即使暂时缺价也应正常展示的 EVM 资产标识。 */
  includedAssetKeys?: string[];
  /** 手工来源创建后尚未添加首条数据时为 false；不得将占位快照计入资产。 */
  hasManualRecord?: boolean;
  /** 手工来源在资产类别分布中的归类；旧数据缺省为待分类。 */
  manualAssetClass?: ManualAssetClass;
  /** 旧数据缺省为 connected；断开后仅保留历史身份与快照。 */
  lifecycle?: "connected" | "disconnected";
}

export interface AssetSourceSyncState {
  status: "current" | "expired";
  lastSuccessfulAt: string;
  lastAttemptAt: string;
  error: string | null;
  /** 可选以兼容旧快照；用于防止价格成功掩盖余额同步失败。 */
  failedMode?: AssetRefreshMode | null;
}

export type AssetRefreshMode = "all" | "prices" | "holdings";

export type AssetRefreshScope = "all" | "evm" | "non-evm";

export interface AssetRefreshReport {
  successCount: number;
  failureCount: number;
}

export interface AssetSynchronization {
  refresh(
    mode: AssetRefreshMode,
    scope?: AssetRefreshScope,
    sourceId?: string,
  ): Promise<AssetRefreshReport>;
}

export interface DailyAssetSourceSnapshot {
  sourceId: string;
  label: string;
  kind: string;
  capturedAt: string;
  complete: boolean;
  /** 旧记录可能缺省；读取时按 complete 安全回退。 */
  status?: "complete" | "incomplete" | "expired";
  /** 旧记录可缺少 HKD；新观测始终写入三种计价货币。 */
  total: Record<"USD" | "CNY", string | null> & {
    HKD?: string | null;
  };
}

interface DailyAssetObservation {
  day: string;
  capturedAt: string;
  /** 用于本次三币种折算的原始汇率观察；旧记录可缺省。 */
  exchangeRates?: AssetExchangeRate[];
  complete: boolean;
  /** 旧记录可能缺省；读取时按 complete 安全回退。 */
  status?: "complete" | "incomplete" | "expired";
  /** 旧记录可缺少 HKD；新观测始终写入三种计价货币。 */
  total: Record<"USD" | "CNY", string | null> & {
    HKD?: string | null;
  };
  sources: DailyAssetSourceSnapshot[];
}

/** Asia/Shanghai 自然日内首次成功同步形成的不可改写基准。 */
export interface DailyAssetBaseline extends DailyAssetObservation {}

/** 每个上海自然日的最佳已有资产价值观测；同日成功刷新可以更新。 */
export interface DailyAssetTrendObservation extends DailyAssetObservation {}

/** 旧接口名称只指日初基准，避免调用方混用两类每日记录。 */
export type DailyAssetSnapshot = DailyAssetBaseline;

export interface DailyAssetSnapshots {
  /** 日初基准，保留用于历史兼容。 */
  list(): Promise<DailyAssetBaseline[]>;
  /** 每日趋势观测，仅用于历史趋势。 */
  listTrendObservations(): Promise<DailyAssetTrendObservation[]>;
  createIfAbsent(snapshot: DailyAssetSnapshot): Promise<boolean>;
  /**
   * 成功刷新建立日初基准（如尚不存在）并更新趋势观测；
   * 失败刷新只更新已存在趋势观测的完整性/过期状态。
   */
  record(
    snapshot: DailyAssetTrendObservation,
    createBaseline: boolean,
  ): Promise<void>;
}

export type FormalSettlementStatus = "complete" | "incomplete" | "missed";

export type FormalSettlementAnchor =
  | {
      key: string;
      kind: "securities-close";
      market: SecuritiesMarket;
      tradingDay: string;
      scheduledCloseAt: string;
    }
  | {
      key: string;
      kind: "crypto-cutoff";
      market: null;
      tradingDay: string;
      scheduledCloseAt: string;
    };

export type SecuritiesMarket = "US" | "HK" | "SH" | "SZ" | "SG";

export interface FormalSettlementSource {
  sourceId: string;
  label: string;
  kind: string;
  capturedAt: string | null;
  status: FormalSettlementStatus;
  diagnostic: string | null;
  total: Record<"USD" | "CNY" | "HKD", string | null>;
}

export interface FormalSettlementHolding {
  sourceId: string;
  sourceAsset: string | null;
  symbol: string;
  name: string;
  quantity: string;
  assetClass: AssetClass;
  price: AssetMoney | null;
  priceBasis: "official-close" | "capture-time" | "unavailable";
  priceObservedAt: string | null;
  market: SecuritiesMarket | null;
  marketTradingDay: string | null;
  marketValue: string | null;
  diagnostic: string | null;
}

export interface FormalDailySettlement {
  anchor: FormalSettlementAnchor;
  capturedAt: string | null;
  status: FormalSettlementStatus;
  diagnostic: string | null;
  total: Record<"USD" | "CNY" | "HKD", string | null>;
  exchangeRates: AssetExchangeRate[];
  sources: FormalSettlementSource[];
  holdings: FormalSettlementHolding[];
}

export interface FormalDailySettlements {
  list(): Promise<FormalDailySettlement[]>;
  recordIfAbsent(settlement: FormalDailySettlement): Promise<boolean>;
}

export interface FormalSettlementSourceCapture {
  capture(input: {
    source: AssetSourceSummary;
    attemptedAt: string;
  }): Promise<AssetSnapshot>;
}

export interface FormalSettlementDailyCandle {
  symbol: string;
  close: string;
  timestamp: string;
  tradeSession: "intraday";
}

export interface FormalSettlementCandleReader {
  readDailyCandles(input: {
    source: AssetSourceSummary;
    symbols: string[];
  }): Promise<FormalSettlementDailyCandle[]>;
}

export interface FormalDailySettlementRunner {
  run(): Promise<{
    outcome: "not-due" | "waiting" | "recorded" | "already-recorded";
  }>;
}

export interface AssetSourceRefreshResult {
  snapshot: AssetSnapshot;
}

export interface AssetSourceRefresher {
  refresh(input: {
    source: AssetSourceSummary;
    credentials: string;
    mode: AssetRefreshMode;
    attemptedAt: string;
    signal: AbortSignal;
    persistCredentials(credentials: string): Promise<void>;
  }): Promise<AssetSourceRefreshResult>;
}

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

export interface AssetSnapshot {
  total: AssetMoney;
  holdings: AssetHolding[];
  exchangeRates: AssetExchangeRate[];
  syncedAt: string;
  /** 可选以兼容旧快照；缺省表示尚未证明产品覆盖范围。 */
  coverage?: AssetSnapshotCoverage;
}

export interface LongbridgeAuthorizationResult {
  credentials: string;
  permissions: AssetPermission[];
  account: { id: string; label: string };
  snapshot: AssetSnapshot;
}

export interface BinanceAuthorizationResult {
  credentials: string;
  permissions: AssetPermission[];
  account: { id: string; label: string };
  snapshot: AssetSnapshot;
}

export interface OkxAuthorizationResult {
  credentials: string;
  permissions: AssetPermission[];
  account: { id: string; label: string };
  scopeFingerprint: string;
  snapshot: AssetSnapshot;
}

export interface BitgetAuthorizationResult {
  credentials: string;
  accountMode: BitgetAccountMode;
  permissions: AssetPermission[];
  account: { id: string; label: string };
  scopeFingerprint: string;
  snapshot: AssetSnapshot;
}

export interface BitAuthorizationResult {
  credentials: string;
  permissions: AssetPermission[];
  account: { id: string; label: string };
  snapshot: AssetSnapshot;
}

export type EvmChain = "ethereum" | "bsc";

export interface ExternalServiceConnectionStatus {
  configured: boolean;
  verifiedAt: string | null;
}

/** 仅返回配置状态；密钥与 RPC URL 本文永不返回浏览器。 */
export interface ExternalServiceConfigurationStatus {
  coinGecko: ExternalServiceConnectionStatus;
  ethereumRpc: ExternalServiceConnectionStatus;
  bscRpc: ExternalServiceConnectionStatus;
}

export interface ExternalServiceConfigurationInput {
  coinGeckoDemoApiKey?: string;
  ethereumRpcUrl?: string;
  bscRpcUrl?: string;
}

/**
 * 全局行情与链节点配置。
 * 外部服务凭证只进入 SecretStore，资产来源仅关联使用结果。
 */
export interface ExternalServiceConfiguration {
  status(): Promise<ExternalServiceConfigurationStatus>;
  saveAndVerify(
    input: ExternalServiceConfigurationInput,
  ): Promise<ExternalServiceConfigurationStatus>;
  coinGeckoDemoApiKey(): Promise<string | null>;
  rpcUrl(chain: EvmChain): Promise<string | null>;
}

export interface EvmWatchAuthorizationResult {
  credentials: string;
  chain: EvmChain;
  permissions: AssetPermission[];
  account: { id: string; label: string };
  snapshot: AssetSnapshot;
}

export type BitgetAccountMode = "classic" | "uta";

export type OkxRegion = "global" | "us" | "eea";

export interface BinanceReadOnly {
  preview(input: {
    apiKey: string;
    apiSecret: string;
    observedAt: string;
  }): Promise<BinanceAuthorizationResult>;
  revalidate(input: {
    credentials: string;
    observedAt: string;
  }): Promise<BinanceAuthorizationResult>;
}

export interface OkxReadOnly {
  preview(input: {
    apiKey: string;
    apiSecret: string;
    passphrase: string;
    region?: OkxRegion;
    observedAt: string;
  }): Promise<OkxAuthorizationResult>;
  revalidate(input: {
    credentials: string;
    observedAt: string;
  }): Promise<OkxAuthorizationResult>;
}

export interface BitgetReadOnly {
  preview(input: {
    apiKey: string;
    apiSecret: string;
    passphrase: string;
    accountMode: BitgetAccountMode;
    observedAt: string;
  }): Promise<BitgetAuthorizationResult>;
  revalidate(input: {
    credentials: string;
    observedAt: string;
  }): Promise<BitgetAuthorizationResult>;
}

/** BIT / Matrixport 钱包与理财产品只读访问。 */
export interface BitReadOnly {
  preview(input: {
    apiKey: string;
    apiSecret: string;
    userId: string;
    observedAt: string;
  }): Promise<BitAuthorizationResult>;
  revalidate(input: {
    credentials: string;
    observedAt: string;
  }): Promise<BitAuthorizationResult>;
}

export interface EvmWatchWalletReadOnly {
  preview(input: {
    chain: EvmChain;
    addresses: string[];
    observedAt: string;
  }): Promise<EvmWatchAuthorizationResult>;
  revalidate(input: {
    credentials: string;
    observedAt: string;
  }): Promise<EvmWatchAuthorizationResult>;
}

export interface LongbridgeOAuth {
  start(redirectUri: string): Promise<{
    authorizationUrl: string;
    state: string;
    codeVerifier: string;
  }>;
  finish(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<LongbridgeAuthorizationResult>;
  revalidate(input: {
    credentials: string;
    observedAt: string;
  }): Promise<LongbridgeAuthorizationResult>;
}

export interface AssetSourceConnections {
  connectLongbridge(result: LongbridgeAuthorizationResult): Promise<void>;
  connectBinance(result: BinanceAuthorizationResult): Promise<void>;
  connectOkx(result: OkxAuthorizationResult): Promise<void>;
  connectBitget(result: BitgetAuthorizationResult): Promise<void>;
  connectBit(result: BitAuthorizationResult): Promise<void>;
  connectEvm(result: EvmWatchAuthorizationResult): Promise<void>;
}

export interface ManualAssetRecordInput {
  /** 按 Asia/Shanghai 解释的自然日，格式 YYYY-MM-DD。 */
  day: string;
  amount: string;
  currency: "USD" | "CNY" | "HKD";
}

export interface ManualAssetRecord extends ManualAssetRecordInput {
  sourceId: string;
  /** 本次新增或编辑的实际保存时间。 */
  recordedAt: string;
}

export interface CreateManualAssetSourceInput {
  label: string;
}

/**
 * 所有者创建无法接入的资产来源，并维护各自的每日总额记录；
 * 每个来源在一个上海自然日只有一条记录。
 */
export interface ManualAssetRecords {
  create(input: CreateManualAssetSourceInput): Promise<void>;
  list(): Promise<ManualAssetRecord[]>;
  record(sourceId: string, input: ManualAssetRecordInput): Promise<void>;
  delete(sourceId: string, day: string): Promise<void>;
}

/** 外部资产来源仅保存服务端凭证引用；凭证正文只能进入 SecretStore。 */
export interface AssetSources {
  list(): Promise<AssetSourceSummary[]>;
  replaceAll(sources: AssetSourceSummary[]): Promise<void>;
  update(source: AssetSourceSummary): Promise<void>;
}

export interface AssetSourceLifecycle {
  setHidden(sourceId: string, hidden: boolean): Promise<void>;
  setDisplayName(sourceId: string, displayName: string): Promise<void>;
  setManualAssetClass(
    sourceId: string,
    assetClass: ManualAssetClass | null,
  ): Promise<void>;
  setEvmTokenPreference(
    sourceId: string,
    assetKeys: string[],
    status: "included" | "ignored" | "unrecognized",
  ): Promise<void>;
  disconnect(sourceId: string): Promise<void>;
  deleteData(sourceId: string): Promise<void>;
}

export interface PriceQuote {
  symbol: string;
  currency: string;
  price: string;
  quotedAt: Date;
}

/** 独立参考价格来源；无可靠价格时返回 null（未估值资产不得按零计）。 */
export interface Prices {
  quote(symbol: string): Promise<PriceQuote | null>;
}

export interface OwnerSession {
  ownerId: string;
  authenticatedAt: Date;
  lastActivityAt: Date;
}

/** 所有者身份认证；未验证身份时返回 null（锁定状态）。 */
export interface OwnerAuth {
  currentSession(): Promise<OwnerSession | null>;
}

/** 预置唯一所有者的 Passkey 凭证（公钥，非秘密）。 */
export interface OwnerCredential {
  id: string;
  publicKey: string;
  counter: number;
  transports?: string[];
}

/** 所有者 Passkey 凭证存储；最多保存一个凭证，不提供公开注册。 */
export interface OwnerCredentialStore {
  get(): Promise<OwnerCredential | null>;
  save(credential: OwnerCredential): Promise<void>;
}

export interface OwnerRecoveryCredential {
  version: 2;
  encryptedTotpSecret: string;
  totpIv: string;
  totpAuthTag: string;
  lastUsedTotpCounter: string | null;
}

/** 备用登录元数据；TOTP 密钥仅以服务端密钥加密后持久化。 */
export interface OwnerRecoveryCredentialStore {
  get(): Promise<OwnerRecoveryCredential | null>;
  save(credential: OwnerRecoveryCredential): Promise<void>;
  claimTotpCounter(counter: string): Promise<boolean>;
}

/** 安全存储：只读凭证等服务端秘密的写入与读取，浏览器不可达。 */
export interface SecretStore {
  put(value: string): Promise<string>;
  get(reference: string): Promise<string | null>;
  replace(reference: string, value: string): Promise<void>;
  remove(reference: string): Promise<void>;
}
