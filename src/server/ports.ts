/**
 * 系统边界端口：时间、卡片存储、外部资产来源、价格、身份认证、安全存储。
 * 测试环境通过替换这些端口注入测试替身；生产组合根不引用任何替身实现。
 */

export interface Clock {
  now(): Date;
}

export type CardAccess = "public" | "private";
export type CardSpan = 1 | 2 | 3;

interface BaseCard {
  id: string;
  span: CardSpan;
  access: CardAccess;
}

export interface IdentityCard extends BaseCard {
  kind: "identity";
  avatarUrl: string;
  nickname: string;
  introduction: string;
}

export interface NowCard extends BaseCard {
  kind: "now";
  content: string;
}

export interface LinkItem {
  label: string;
  url: string;
}

export interface LinksCard extends BaseCard {
  kind: "links";
  links: LinkItem[];
}

export interface MarkdownCard extends BaseCard {
  kind: "markdown";
  title: string;
  markdown: string;
}

export interface AssetCard extends Omit<BaseCard, "access"> {
  kind: "asset";
  access: "private";
  title: string;
  body: string;
  sourceId?: string;
}

export type Card =
  | IdentityCard
  | NowCard
  | LinksCard
  | MarkdownCard
  | AssetCard;

export interface CardStore {
  list(): Promise<Card[]>;
  replaceAll(cards: Card[]): Promise<void>;
}

export interface AssetSourceSummary {
  id: string;
  kind: string;
  label: string;
  accountId: string;
  permissions: AssetPermission[];
  credentialReference: string;
  snapshot: AssetSnapshot;
  sync: AssetSourceSyncState;
}

export interface AssetSourceSyncState {
  status: "current" | "expired";
  lastSuccessfulAt: string;
  lastAttemptAt: string;
  error: string | null;
}

export type AssetRefreshMode = "all" | "prices" | "holdings";

export interface AssetRefreshReport {
  successCount: number;
  failureCount: number;
}

export interface AssetSynchronization {
  refresh(mode: AssetRefreshMode): Promise<AssetRefreshReport>;
}

export interface DailyAssetSourceSnapshot {
  sourceId: string;
  label: string;
  kind: string;
  capturedAt: string;
  complete: boolean;
  total: Record<"USD" | "CNY", string | null>;
}

/** Asia/Shanghai 自然日内首次成功同步形成的不可改写基准。 */
export interface DailyAssetSnapshot {
  day: string;
  capturedAt: string;
  complete: boolean;
  total: Record<"USD" | "CNY", string | null>;
  sources: DailyAssetSourceSnapshot[];
}

export interface DailyAssetSnapshots {
  list(): Promise<DailyAssetSnapshot[]>;
  createIfAbsent(snapshot: DailyAssetSnapshot): Promise<boolean>;
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
  | "account"
  | "positions"
  | "trade"
  | "transfer"
  | "withdraw";

export interface AssetMoney {
  amount: string;
  currency: string;
}

export type AssetClass = "securities" | "crypto";

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
    };

export interface AssetHolding {
  symbol: string;
  name: string;
  /** 来源内资产标识与账户分区；用于同一资产跨分区保持独立。 */
  sourceAsset?: string;
  sourceAccount?: "spot" | "funding" | "earn-flexible" | "earn-locked";
  quantity: string;
  currency: string;
  assetClass: AssetClass;
  currentPrice: AssetMoney | null;
  marketValue: string | null;
  /** 来源按账户计价货币给出的可比较市值，仅用于来源内排序与汇总。 */
  sourceMarketValue: AssetMoney | null;
  valuation: AssetValuation;
  costPrice: string | null;
  platformProfit: string | null;
  changePercent: string | null;
}

export interface AssetSnapshot {
  total: AssetMoney;
  holdings: AssetHolding[];
  exchangeRates: AssetExchangeRate[];
  syncedAt: string;
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
}

export interface AssetSourceConnections {
  connectLongbridge(result: LongbridgeAuthorizationResult): Promise<void>;
  connectBinance(result: BinanceAuthorizationResult): Promise<void>;
  connectOkx(result: OkxAuthorizationResult): Promise<void>;
  connectBitget(result: BitgetAuthorizationResult): Promise<void>;
}

/** 外部资产来源仅保存服务端凭证引用；凭证正文只能进入 SecretStore。 */
export interface AssetSources {
  list(): Promise<AssetSourceSummary[]>;
  replaceAll(sources: AssetSourceSummary[]): Promise<void>;
  update(source: AssetSourceSummary): Promise<void>;
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

/** 所有者身份认证；未验证身份时返回 null（访客）。 */
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
  email: string;
  passwordSalt: string;
  passwordHash: string;
  encryptedTotpSecret: string;
  totpIv: string;
  totpAuthTag: string;
}

/** 恢复认证元数据；TOTP 密钥仅以恢复密码派生密钥加密后持久化。 */
export interface OwnerRecoveryCredentialStore {
  get(): Promise<OwnerRecoveryCredential | null>;
  save(credential: OwnerRecoveryCredential): Promise<void>;
}

/** 安全存储：只读凭证等服务端秘密的写入与读取，浏览器不可达。 */
export interface SecretStore {
  put(value: string): Promise<string>;
  get(reference: string): Promise<string | null>;
  replace(reference: string, value: string): Promise<void>;
  remove(reference: string): Promise<void>;
}
