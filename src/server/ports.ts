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
}

/** 外部资产来源的只读契约；后续 Ticket 在此扩展同步能力。 */
export interface AssetSources {
  list(): Promise<AssetSourceSummary[]>;
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

/** 安全存储：只读凭证等服务端秘密的写入与读取，浏览器不可达。 */
export interface SecretStore {
  put(value: string): Promise<string>;
  get(reference: string): Promise<string | null>;
  remove(reference: string): Promise<void>;
}
