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
  kind: "longbridge";
  label: string;
  accountId: string;
  permissions: AssetPermission[];
  credentialReference: string;
  snapshot: AssetSnapshot;
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

export interface AssetHolding {
  symbol: string;
  name: string;
  quantity: string;
  currency: string;
  marketValue: string;
  /** 来源按账户计价货币给出的可比较市值，仅用于来源内排序与汇总。 */
  sourceMarketValue: AssetMoney;
  costPrice: string | null;
  platformProfit: string | null;
  changePercent: string | null;
}

export interface AssetSnapshot {
  total: AssetMoney;
  holdings: AssetHolding[];
  syncedAt: string;
}

export interface LongbridgeAuthorizationResult {
  credentials: string;
  permissions: AssetPermission[];
  account: { id: string; label: string };
  snapshot: AssetSnapshot;
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
}

/** 外部资产来源仅保存服务端凭证引用；凭证正文只能进入 SecretStore。 */
export interface AssetSources {
  list(): Promise<AssetSourceSummary[]>;
  replaceAll(sources: AssetSourceSummary[]): Promise<void>;
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
  remove(reference: string): Promise<void>;
}
