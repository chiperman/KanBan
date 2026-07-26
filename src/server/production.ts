import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { decimalAdd, decimalCompare, decimalDivide } from "@/domain/decimal";
import type {
  AppServices,
  Card,
} from "@/server/composition";
import type {
  AssetSourceSummary,
  AssetSnapshot,
  AssetSourceConnections,
  AssetSources,
  CardStore,
  Clock,
  OwnerAuth,
  OwnerCredential,
  OwnerCredentialStore,
  OwnerRecoveryCredential,
  OwnerRecoveryCredentialStore,
  Prices,
  PriceQuote,
  SecretStore,
  LongbridgeAuthorizationResult,
} from "@/server/ports";
import { SessionOwnerAuth } from "@/server/auth/session-auth";
import { parseCards } from "@/server/cards";
import {
  LongbridgeConnectionState,
  ProductionLongbridgeOAuth,
} from "@/server/asset-sources/longbridge";

class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

interface DashboardState {
  schemaVersion: 2;
  cards: Card[];
  assetSources: AssetSourceSummary[];
}

const DASHBOARD_SCHEMA_VERSION = 2 as const;

function migrateAssetSource(raw: unknown): AssetSourceSummary {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("资产来源数据格式无效");
  }
  const source = raw as AssetSourceSummary;
  if (
    typeof source.snapshot !== "object" ||
    source.snapshot === null ||
    !Array.isArray(source.snapshot.holdings)
  ) {
    throw new Error("资产来源快照格式无效");
  }
  const snapshot = source.snapshot as AssetSnapshot;
  const legacySnapshot =
    !Array.isArray(snapshot.exchangeRates) ||
    snapshot.holdings.some(
      (holding) =>
        !Object.hasOwn(holding, "assetClass") ||
        !Object.hasOwn(holding, "currentPrice") ||
        !Object.hasOwn(holding, "sourceMarketValue") ||
        !Object.hasOwn(holding, "valuation"),
    );
  const exchangeRates = Array.isArray(snapshot.exchangeRates)
    ? snapshot.exchangeRates
    : [];
  const holdings = snapshot.holdings.map((holding) => {
    const legacy = holding as typeof holding & {
      assetClass?: typeof holding.assetClass;
      currentPrice?: typeof holding.currentPrice;
      sourceMarketValue?: typeof holding.sourceMarketValue;
      valuation?: typeof holding.valuation;
    };
    const hasCurrentPrice = Object.hasOwn(legacy, "currentPrice");
    const hasSourceMarketValue = Object.hasOwn(legacy, "sourceMarketValue");
    const hasValuation = Object.hasOwn(legacy, "valuation");
    const canDerivePrice =
      typeof legacy.marketValue === "string" &&
      typeof legacy.quantity === "string" &&
      decimalCompare(legacy.quantity, "0") !== 0;
    const currentPrice = hasCurrentPrice
      ? legacy.currentPrice ?? null
      : canDerivePrice
        ? {
            amount: decimalDivide(legacy.marketValue!, legacy.quantity),
            currency: legacy.currency,
          }
        : null;
    const sourceMarketValue = hasSourceMarketValue
      ? legacy.sourceMarketValue ?? null
      : typeof legacy.marketValue === "string" &&
          legacy.currency === snapshot.total.currency
        ? { amount: legacy.marketValue, currency: snapshot.total.currency }
        : null;
    const valuation = hasValuation
      ? legacy.valuation
      : currentPrice !== null && sourceMarketValue !== null
        ? {
            status: "valued" as const,
            priceSource: `${source.label} 旧快照`,
            pricedAt: snapshot.syncedAt,
          }
        : {
            status: "unvalued" as const,
            reason: currentPrice === null
              ? "旧快照没有可靠价格"
              : `缺少 ${legacy.currency}/${snapshot.total.currency} 显式汇率`,
          };
    return {
      ...legacy,
      assetClass: legacy.assetClass ?? "securities",
      currentPrice,
      sourceMarketValue,
      valuation,
    };
  });
  const hasUnvaluedLegacyHolding =
    legacySnapshot &&
    holdings.some(
      (holding) =>
        holding.valuation.status === "unvalued" ||
        holding.sourceMarketValue === null,
    );
  const total = hasUnvaluedLegacyHolding
    ? {
        amount: decimalAdd(
          ...holdings.flatMap((holding) =>
            holding.sourceMarketValue?.currency === snapshot.total.currency
              ? [holding.sourceMarketValue.amount]
              : [],
          ),
        ),
        currency: snapshot.total.currency,
      }
    : snapshot.total;
  return {
    ...source,
    snapshot: {
      ...snapshot,
      total,
      holdings,
      exchangeRates,
    },
  };
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

/** 普通 Dashboard 数据只保存不透明凭证引用，不保存凭证或密文。 */
export class FileDashboardDatabase {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly legacyCardsPath: string,
  ) {}

  private async load(): Promise<DashboardState> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      let cards: Card[] = [];
      try {
        const legacy = parseCards(
          JSON.parse(await readFile(this.legacyCardsPath, "utf8")),
        );
        if (legacy === null) throw new Error("旧卡片数据格式无效");
        cards = legacy;
      } catch (legacyError) {
        if (!isMissingFile(legacyError)) throw legacyError;
      }
      return {
        schemaVersion: DASHBOARD_SCHEMA_VERSION,
        cards,
        assetSources: [],
      };
    }
    const value = JSON.parse(raw) as Partial<DashboardState>;
    const cards = parseCards(value.cards);
    if (
      cards === null ||
      !Array.isArray(value.assetSources)
    ) {
      throw new Error(`Dashboard 数据文件格式无效: ${this.filePath}`);
    }
    return {
      schemaVersion: DASHBOARD_SCHEMA_VERSION,
      cards,
      assetSources: value.assetSources.map(migrateAssetSource),
    };
  }

  private async write(state: DashboardState): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(state, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, this.filePath);
  }

  private mutate<T>(operation: (state: DashboardState) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const state = await this.load();
      const result = operation(state);
      await this.write(state);
      return result;
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async listCards(): Promise<Card[]> {
    await this.queue;
    return (await this.load()).cards;
  }

  async replaceCards(cards: Card[]): Promise<void> {
    await this.mutate((state) => {
      state.cards = cards;
    });
  }

  async listSources(): Promise<AssetSourceSummary[]> {
    await this.queue;
    return (await this.load()).assetSources;
  }

  async replaceSources(sources: AssetSourceSummary[]): Promise<void> {
    await this.mutate((state) => {
      state.assetSources = sources;
    });
  }

  async connectLongbridge(
    result: LongbridgeAuthorizationResult,
    credentialReference: string,
  ): Promise<void> {
    await this.mutate((state) => {
      const sourceId = randomUUID();
      state.assetSources.push({
        id: sourceId,
        kind: "longbridge",
        label: result.account.label,
        accountId: result.account.id,
        permissions: result.permissions,
        credentialReference,
        snapshot: result.snapshot,
      });
      state.cards.push({
        id: randomUUID(),
        kind: "asset",
        access: "private",
        title: "长桥资产",
        body: "只读证券账户",
        sourceId,
        span: 2,
      });
    });
  }
}

/** 独立加密凭证文件；普通 Dashboard 数据与同步快照无法读取其内容。 */
interface StoredSecret {
  sealed: string;
  state: "pending" | "committed";
}

export class FileEncryptedSecretStore implements SecretStore {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private key(): Buffer {
    const encoded = process.env.PAD_SECRET_ENCRYPTION_KEY;
    const key = encoded ? Buffer.from(encoded, "base64") : Buffer.alloc(0);
    if (key.length !== 32) {
      throw new Error(
        "PAD_SECRET_ENCRYPTION_KEY 必须配置为 32 字节 Base64 服务端密钥",
      );
    }
    return key;
  }

  private seal(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return JSON.stringify({
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      value: encrypted.toString("base64"),
    });
  }

  private unseal(sealed: string): string {
    const parsed = JSON.parse(sealed) as { iv: string; tag: string; value: string };
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key(),
      Buffer.from(parsed.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(parsed.value, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }

  private async load(): Promise<Record<string, StoredSecret>> {
    try {
      const value: unknown = JSON.parse(await readFile(this.filePath, "utf8"));
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`凭证存储格式无效: ${this.filePath}`);
      }
      return value as Record<string, StoredSecret>;
    } catch (error) {
      if (isMissingFile(error)) return {};
      throw error;
    }
  }

  private async write(values: Record<string, StoredSecret>): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(values), {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, this.filePath);
  }

  private mutate<T>(operation: (values: Record<string, StoredSecret>) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const values = await this.load();
      const result = operation(values);
      await this.write(values);
      return result;
    });
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  stage(value: string): Promise<string> {
    return this.mutate((values) => {
      const reference = randomUUID();
      values[reference] = { sealed: this.seal(value), state: "pending" };
      return reference;
    });
  }

  commit(reference: string): Promise<void> {
    return this.mutate((values) => {
      const value = values[reference];
      if (!value) throw new Error("待提交凭证不存在");
      value.state = "committed";
    });
  }

  async put(value: string): Promise<string> {
    const reference = await this.stage(value);
    await this.commit(reference);
    return reference;
  }

  async get(reference: string): Promise<string | null> {
    await this.queue;
    const value = (await this.load())[reference];
    return value?.state === "committed" ? this.unseal(value.sealed) : null;
  }

  remove(reference: string): Promise<void> {
    return this.mutate((values) => {
      delete values[reference];
    });
  }

  recover(validReferences: Set<string>): Promise<void> {
    return this.mutate((values) => {
      for (const [reference, value] of Object.entries(values)) {
        if (value.state !== "pending") continue;
        if (validReferences.has(reference)) value.state = "committed";
        else delete values[reference];
      }
    });
  }
}

class DatabaseCardStore implements CardStore {
  constructor(private readonly database: FileDashboardDatabase) {}
  list() { return this.database.listCards(); }
  replaceAll(cards: Card[]) { return this.database.replaceCards(cards); }
}

class DatabaseAssetSources implements AssetSources {
  constructor(private readonly database: FileDashboardDatabase) {}
  list() { return this.database.listSources(); }
  replaceAll(sources: AssetSourceSummary[]) { return this.database.replaceSources(sources); }
}

export class DatabaseAssetSourceConnections implements AssetSourceConnections {
  constructor(
    private readonly database: FileDashboardDatabase,
    private readonly secrets: FileEncryptedSecretStore,
    private readonly ready: Promise<void> = Promise.resolve(),
  ) {}
  async connectLongbridge(result: LongbridgeAuthorizationResult) {
    await this.ready;
    const credentialReference = await this.secrets.stage(result.credentials);
    try {
      await this.database.connectLongbridge(result, credentialReference);
    } catch (error) {
      try {
        await this.secrets.remove(credentialReference);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "资产来源写入失败，待回收凭证将在启动恢复时清理",
        );
      }
      throw error;
    }
    // Dashboard 中的引用是提交点；若标记写入中断，启动恢复会按该引用提升 pending。
    await this.secrets.commit(credentialReference).catch(() => undefined);
  }
}

class ReadySecretStore implements SecretStore {
  constructor(
    private readonly secrets: FileEncryptedSecretStore,
    private readonly ready: Promise<void>,
  ) {}
  async put(value: string) {
    await this.ready;
    return this.secrets.put(value);
  }
  async get(reference: string) {
    await this.ready;
    return this.secrets.get(reference);
  }
  async remove(reference: string) {
    await this.ready;
    return this.secrets.remove(reference);
  }
}

/** 首版尚未接入参考价格来源；无可靠价格时一律返回 null。 */
class NoPrices implements Prices {
  async quote(): Promise<PriceQuote | null> {
    return null;
  }
}

function isOwnerCredential(value: unknown): value is OwnerCredential {
  if (typeof value !== "object" || value === null) return false;
  const credential = value as Record<string, unknown>;
  return (
    typeof credential.id === "string" &&
    typeof credential.publicKey === "string" &&
    typeof credential.counter === "number"
  );
}

class FileOwnerCredentialStore implements OwnerCredentialStore {
  constructor(private readonly filePath: string) {}

  async get(): Promise<OwnerCredential | null> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch {
      return null;
    }
    const value: unknown = JSON.parse(raw);
    if (!isOwnerCredential(value)) {
      throw new Error(`所有者凭证文件格式无效: ${this.filePath}`);
    }
    return value;
  }

  async save(credential: OwnerCredential): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(credential, null, 2), "utf8");
  }
}

function isOwnerRecoveryCredential(
  value: unknown,
): value is OwnerRecoveryCredential {
  if (typeof value !== "object" || value === null) return false;
  const credential = value as Record<string, unknown>;
  return (
    typeof credential.email === "string" &&
    typeof credential.passwordSalt === "string" &&
    typeof credential.passwordHash === "string" &&
    typeof credential.encryptedTotpSecret === "string" &&
    typeof credential.totpIv === "string" &&
    typeof credential.totpAuthTag === "string"
  );
}

class FileOwnerRecoveryCredentialStore
  implements OwnerRecoveryCredentialStore
{
  constructor(private readonly filePath: string) {}

  async get(): Promise<OwnerRecoveryCredential | null> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch {
      return null;
    }
    const value: unknown = JSON.parse(raw);
    if (!isOwnerRecoveryCredential(value)) {
      throw new Error(`恢复认证文件格式无效: ${this.filePath}`);
    }
    return value;
  }

  async save(credential: OwnerRecoveryCredential): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(credential, null, 2), "utf8");
  }
}

export function createProductionServices(): AppServices {
  const dataDir = path.join(process.cwd(), "data");
  const clock = new SystemClock();
  const database = new FileDashboardDatabase(
    path.join(dataDir, "dashboard.json"),
    path.join(dataDir, "cards.json"),
  );
  const secrets = new FileEncryptedSecretStore(
    path.join(dataDir, "secrets.json"),
  );
  const secretRecovery = database.listSources().then((sources) =>
    secrets.recover(new Set(sources.map((source) => source.credentialReference))),
  );
  void secretRecovery.catch(() => undefined);
  return {
    clock,
    cards: new DatabaseCardStore(database),
    assetSources: new DatabaseAssetSources(database),
    prices: new NoPrices(),
    auth: new SessionOwnerAuth(clock),
    ownerCredentials: new FileOwnerCredentialStore(
      path.join(dataDir, "owner-credential.json"),
    ),
    ownerRecoveryCredentials: new FileOwnerRecoveryCredentialStore(
      path.join(dataDir, "owner-recovery.json"),
    ),
    secrets: new ReadySecretStore(secrets, secretRecovery),
    longbridge: new ProductionLongbridgeOAuth(),
    longbridgeConnections: new LongbridgeConnectionState(),
    assetSourceConnections: new DatabaseAssetSourceConnections(
      database,
      secrets,
      secretRecovery,
    ),
  };
}
