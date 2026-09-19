import { ObservedFormalSettlementRunner } from "@/server/formal-settlement-execution";
import { LocalFormalSettlementScheduler } from "@/server/formal-settlement-scheduler";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID, } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";

import { normalizeAssetSourceDisplayName } from "@/domain/asset-source-display-name";
import { updateEvmTokenPreferences } from "@/domain/evm-token-preferences";
import { AssetSourceOnboarding } from "@/server/asset-source-onboarding";
import { createAssetSourceProviderAdapters } from "@/server/asset-source-provider-adapters";
import { CoinGeckoUsdtUsdPrices, ProductionBinanceReadOnly, ProductionBinanceSourceRefresher, } from "@/server/asset-sources/binance";
import { ProductionBitReadOnly, ProductionBitSourceRefresher, } from "@/server/asset-sources/bit";
import { ProductionBitgetReadOnly, ProductionBitgetSourceRefresher, } from "@/server/asset-sources/bitget";
import { ProductionEvmWatchSourceRefresher, ProductionEvmWatchWallet, } from "@/server/asset-sources/ethereum";
import { KeychainLongbridgeBenchmarkCandlestickReader, KeychainLongbridgeFormalSettlementCandleReader, KeychainLongbridgeHoldingCandlestickReader, KeychainLongbridgeOAuth, KeychainLongbridgeSourceRefresher, LongbridgeOAuthState } from "@/server/asset-sources/longbridge";
import { isMacOSKeychainCredentialReference } from "@/server/asset-sources/longbridge-keychain-sdk";
import { ProductionOkxReadOnly, ProductionOkxSourceRefresher, } from "@/server/asset-sources/okx";
import { RoutedAssetSourceRefresher } from "@/server/asset-sources/router";
import { SourceIsolatedAssetSynchronization } from "@/server/asset-synchronization";
import { SessionOwnerAuth } from "@/server/auth/session-auth";
import { CredentialFreeBusinessDataBackup } from "@/server/business-data-backup";
import type { AppServices, Card, } from "@/server/composition";
import { FileExternalServiceConfiguration } from "@/server/external-service-configuration";
import { MarketCloseFormalDailySettlement, ReadOnlyFormalSettlementSourceCapture, } from "@/server/formal-daily-settlement";
import { InvestmentCashflowLedger } from "@/server/investment-cashflows";
import { atomicWritePrivateFile, hardenLocalDataPermissions, readPrivateFile, } from "@/server/local-data-permissions";
import type { DashboardDatabase } from "@/server/persistence/contracts";
import { isMissingFile } from "@/server/persistence/file-errors";
import type { SourceAuthorizationResult, SourceConnectionKind } from "@/server/persistence/source-record";
import { connectedSourceKind } from "@/server/persistence/source-record";
import { SqliteDashboardDatabase } from "@/server/persistence/sqlite-database";
import type { AssetCardStore, AssetFullRefreshState, AssetSourceConnections, AssetSourceLifecycle, AssetSources, AssetSourceSummary, BinanceAuthorizationResult, BitAuthorizationResult, BitgetAuthorizationResult, Clock, CreateManualAssetSourceInput, DailyAssetSnapshot, DailyAssetSnapshots, DailyAssetTrendObservation, EvmWatchAuthorizationResult, ExternalServiceConfiguration, FormalDailySettlement, FormalDailySettlements, FormalSettlementExecution, FormalSettlementExecutions, LongbridgeAuthorizationResult, ManualAssetClass, ManualAssetRecord, ManualAssetRecordInput, ManualAssetRecords, OkxAuthorizationResult, OwnerCredential, OwnerCredentialStore, OwnerRecoveryCredential, OwnerRecoveryCredentialStore, SecretStore } from "@/server/ports";

class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** 独立加密凭证文件；普通 Dashboard 数据与同步快照无法读取其内容。 */
interface StoredSecret {
  sealed: string;
  state: "pending" | "committed";
}

interface TransactionalSecretStore extends SecretStore {
  stage(value: string): Promise<string>;
  commit(reference: string): Promise<void>;
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
      const value: unknown = JSON.parse(await readPrivateFile(this.filePath));
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
    await atomicWritePrivateFile(this.filePath, JSON.stringify(values));
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

  replace(reference: string, value: string): Promise<void> {
    return this.mutate((values) => {
      const current = values[reference];
      if (!current || current.state !== "committed") {
        throw new Error("凭证引用不存在或尚未提交");
      }
      current.sealed = this.seal(value);
    });
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

class DatabaseAssetCardStore implements AssetCardStore {
  constructor(private readonly database: DashboardDatabase) {}
  list() { return this.database.listAssetCards(); }
  replaceAll(cards: Card[]) { return this.database.replaceAssetCards(cards); }
}

class DatabaseAssetSources implements AssetSources {
  constructor(private readonly database: DashboardDatabase) {}
  list() { return this.database.listSources(); }
  replaceAll(sources: AssetSourceSummary[]) { return this.database.replaceSources(sources); }
  update(source: AssetSourceSummary) { return this.database.updateSource(source); }
}

class DatabaseManualAssetRecords implements ManualAssetRecords {
  constructor(
    private readonly database: DashboardDatabase,
    private readonly clock: Clock,
  ) {}

  create(input: CreateManualAssetSourceInput): Promise<void> {
    return this.database.createManualAssetSource(
      input,
      this.clock.now().toISOString(),
    );
  }

  list(): Promise<ManualAssetRecord[]> {
    return this.database.listManualAssetRecords();
  }

  record(
    sourceId: string,
    input: ManualAssetRecordInput,
  ): Promise<void> {
    return this.database.recordManualAssetSource(
      sourceId,
      input,
      this.clock.now().toISOString(),
    );
  }

  delete(sourceId: string, day: string): Promise<void> {
    return this.database.deleteManualAssetSourceRecord(
      sourceId,
      day,
      this.clock.now().toISOString(),
    );
  }
}

class DatabaseDailyAssetSnapshots implements DailyAssetSnapshots {
  constructor(private readonly database: DashboardDatabase) {}
  list() { return this.database.listDailyAssetSnapshots(); }
  listTrendObservations() {
    return this.database.listDailyAssetTrendObservations();
  }
  listImportedSourceHistoryObservations() {
    return this.database.listImportedSourceHistoryObservations();
  }
  createIfAbsent(snapshot: DailyAssetSnapshot) {
    return this.database.createDailyAssetSnapshotIfAbsent(snapshot);
  }
  record(snapshot: DailyAssetTrendObservation, createBaseline: boolean) {
    return this.database.recordDailyAssetObservation(snapshot, createBaseline);
  }
}

export class DatabaseAssetFullRefreshState implements AssetFullRefreshState {
  constructor(private readonly database: SqliteDashboardDatabase) {}

  read() { return this.database.readAssetFullRefreshState(); }
  initialize(attemptedAt: string) {
    return this.database.initializeAssetFullRefresh(attemptedAt);
  }
  claim(input: {
    attemptedAt: string;
    intervalMs: number;
    staleAfterMs: number;
    force: boolean;
  }) {
    return this.database.claimAssetFullRefresh(input);
  }
  start(attemptedAt: string) {
    return this.database.startAssetFullRefresh(attemptedAt);
  }
  finish(attemptedAt?: string) {
    return this.database.finishAssetFullRefresh(attemptedAt);
  }
  clear() { return this.database.clearAssetFullRefresh(); }
}

export class DatabaseFormalSettlementExecutions implements FormalSettlementExecutions {
  constructor(private readonly database: SqliteDashboardDatabase) {}
  latest() { return this.database.latestFormalSettlementExecution(); }
  record(execution: FormalSettlementExecution) {
    return this.database.recordFormalSettlementExecution(execution);
  }
}

export class DatabaseFormalDailySettlements implements FormalDailySettlements {
  constructor(private readonly database: SqliteDashboardDatabase) {}

  list() {
    return this.database.listFormalDailySettlements();
  }

  recordIfAbsent(settlement: FormalDailySettlement) {
    return this.database.recordFormalDailySettlementIfAbsent(settlement);
  }
}

class DatabaseAssetSourceLifecycle implements AssetSourceLifecycle {
  constructor(
    private readonly database: DashboardDatabase,
    private readonly secrets: SecretStore,
    private readonly fullRefreshState: AssetFullRefreshState,
  ) {}

  private async clearCycleWhenNoRefreshableSources(): Promise<void> {
    const hasRefreshableSource = (await this.database.listSources()).some(
      (source) =>
        source.kind !== "manual" &&
        source.lifecycle !== "disconnected" &&
        source.credentialReference !== null,
    );
    if (!hasRefreshableSource) await this.fullRefreshState.clear();
  }

  setHidden(sourceId: string, hidden: boolean): Promise<void> {
    return this.database.setAssetCardHidden(sourceId, hidden);
  }

  setDisplayName(sourceId: string, displayName: string): Promise<void> {
    return this.database.setAssetSourceDisplayName(
      sourceId,
      normalizeAssetSourceDisplayName(displayName),
    );
  }

  setManualAssetClass(
    sourceId: string,
    assetClass: ManualAssetClass | null,
  ): Promise<void> {
    return this.database.setAssetSourceManualClass(sourceId, assetClass);
  }

  async setEvmTokenPreference(
    sourceId: string,
    assetKeys: string[],
    status: "included" | "ignored" | "unrecognized",
  ): Promise<void> {
    const source = (await this.database.listSources()).find(
      (item) => item.id === sourceId,
    );
    if (!source) throw new Error("资产来源不存在");
    const preferences = updateEvmTokenPreferences(
      source,
      assetKeys,
      status,
    );
    await this.database.setAssetSourceEvmTokenPreferences(
      sourceId,
      preferences.ignoredAssetKeys,
      preferences.includedAssetKeys,
    );
  }

  async disconnect(sourceId: string): Promise<void> {
    const source = (await this.database.listSources()).find(
      (item) => item.id === sourceId,
    );
    if (!source) throw new Error("资产来源不存在");
    if (source.kind === "manual") {
      throw new Error("手工资产记录不支持断开");
    }
    if (source.credentialReference !== null) {
      await this.secrets.remove(source.credentialReference);
    }
    await this.database.disconnectAssetSource(sourceId);
    await this.clearCycleWhenNoRefreshableSources();
  }

  async restore(sourceId: string): Promise<void> {
    const source = (await this.database.listSources()).find(
      (item) => item.id === sourceId,
    );
    if (!source) throw new Error("资产来源不存在");
    if (source.kind === "manual") {
      throw new Error("手工资产记录不支持恢复连接");
    }
    if (source.lifecycle !== "disconnected") {
      throw new Error("资产来源仍处于连接状态，无需恢复");
    }
    if (
      source.credentialReference === null ||
      (await this.secrets.get(source.credentialReference)) === null
    ) {
      throw new Error(
        "原连接凭证已不存在，无法直接恢复。请重新输入原公开地址；原卡片和历史数据仍保留。",
      );
    }
    await this.database.updateSource({ ...source, lifecycle: "connected" });
  }

  async deleteData(sourceId: string): Promise<void> {
    const reference = await this.database.deleteAssetSourceData(sourceId);
    if (reference !== null) await this.secrets.remove(reference);
    await this.clearCycleWhenNoRefreshableSources();
  }
}

export class DatabaseAssetSourceConnections implements AssetSourceConnections {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly database: DashboardDatabase,
    private readonly secrets: TransactionalSecretStore,
    private readonly ready: Promise<void> = Promise.resolve(),
    private readonly clock: Clock = new SystemClock(),
    private readonly fullRefreshState: AssetFullRefreshState,
  ) {}

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async connect(
    sourceKind: SourceConnectionKind,
    result:
      | LongbridgeAuthorizationResult
      | BinanceAuthorizationResult
      | OkxAuthorizationResult
      | BitgetAuthorizationResult
      | BitAuthorizationResult
      | EvmWatchAuthorizationResult,
    save: (credentialReference: string, capturedAt: string) => Promise<void>,
  ) {
    await this.ready;
    const capturedAt = this.clock.now().toISOString();
    const usesKeychainReference =
      sourceKind === "longbridge" &&
      isMacOSKeychainCredentialReference(result.credentials);
    const credentialReference = usesKeychainReference
      ? result.credentials
      : await this.secrets.stage(result.credentials);
    let isFirstAutomaticSource: boolean;
    try {
      isFirstAutomaticSource = !(await this.database.listSources()).some(
        (source) =>
          source.kind !== "manual" &&
          source.lifecycle !== "disconnected" &&
          source.credentialReference !== null,
      );
      await save(credentialReference, capturedAt);
    } catch (error) {
      if (usesKeychainReference) throw error;
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
    if (!usesKeychainReference) {
      try {
        await this.secrets.commit(credentialReference);
      } catch (error) {
        try {
          const source = (await this.database.listSources()).find(
            (item) => item.credentialReference === credentialReference,
          );
          if (source) await this.database.deleteAssetSourceData(source.id);
          await this.secrets.remove(credentialReference);
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "凭证提交失败，资产来源补偿回滚也未能完成",
          );
        }
        throw error;
      }
    }
    if (isFirstAutomaticSource) {
      await this.fullRefreshState.initialize(capturedAt);
    }
  }

  private async replaceExisting(
    sourceId: string,
    sourceKind: SourceConnectionKind,
    result: SourceAuthorizationResult,
  ): Promise<void> {
    await this.ready;
    const isFirstAutomaticSource = !(await this.database.listSources()).some(
      (source) =>
        source.kind !== "manual" &&
        source.lifecycle !== "disconnected" &&
        source.credentialReference !== null,
    );
    const capturedAt = this.clock.now().toISOString();
    const usesKeychainReference =
      sourceKind === "longbridge" &&
      isMacOSKeychainCredentialReference(result.credentials);
    const credentialReference = usesKeychainReference
      ? result.credentials
      : await this.secrets.stage(result.credentials);
    if (!usesKeychainReference) {
      try {
        await this.secrets.commit(credentialReference);
      } catch (error) {
        await this.secrets.remove(credentialReference);
        throw error;
      }
    }

    let previousReference: string | null;
    try {
      previousReference = await this.database.reconnectAssetSource(
        sourceId,
        sourceKind,
        result,
        credentialReference,
        capturedAt,
      );
    } catch (error) {
      if (!usesKeychainReference) await this.secrets.remove(credentialReference);
      throw error;
    }
    if (
      previousReference !== null &&
      previousReference !== credentialReference &&
      !isMacOSKeychainCredentialReference(previousReference)
    ) {
      await this.secrets.remove(previousReference);
    }
    if (isFirstAutomaticSource) {
      await this.fullRefreshState.initialize(capturedAt);
    }
  }

  private connectOrReplace(
    sourceKind: SourceConnectionKind,
    result: SourceAuthorizationResult,
    save: (credentialReference: string, capturedAt: string) => Promise<void>,
  ): Promise<void> {
    return this.serialize(() =>
      this.connectOrReplaceSerialized(sourceKind, result, save),
    );
  }

  private async connectOrReplaceSerialized(
    sourceKind: SourceConnectionKind,
    result: SourceAuthorizationResult,
    save: (credentialReference: string, capturedAt: string) => Promise<void>,
  ): Promise<void> {
    await this.ready;
    const kind = connectedSourceKind(sourceKind, result);
    const existing = (await this.database.listSources()).find(
      (source) =>
        source.kind === kind && source.accountId === result.account.id,
    );
    if (existing) {
      await this.replaceExisting(existing.id, sourceKind, result);
      return;
    }
    await this.connect(sourceKind, result, save);
  }

  connectLongbridge(result: LongbridgeAuthorizationResult) {
    return this.connectOrReplace("longbridge", result, (reference, capturedAt) =>
      this.database.connectLongbridge(result, reference, capturedAt));
  }

  async reconnectLongbridge(
    sourceId: string,
    result: LongbridgeAuthorizationResult,
  ): Promise<void> {
    await this.serialize(() =>
      this.replaceExisting(sourceId, "longbridge", result),
    );
  }

  connectBinance(result: BinanceAuthorizationResult) {
    return this.connectOrReplace("binance", result, (reference, capturedAt) =>
      this.database.connectBinance(result, reference, capturedAt));
  }

  connectOkx(result: OkxAuthorizationResult) {
    return this.connectOrReplace("okx", result, (reference, capturedAt) =>
      this.database.connectOkx(result, reference, capturedAt));
  }

  connectBitget(result: BitgetAuthorizationResult) {
    return this.connectOrReplace("bitget", result, (reference, capturedAt) =>
      this.database.connectBitget(result, reference, capturedAt));
  }

  connectBit(result: BitAuthorizationResult) {
    return this.connectOrReplace("bit", result, (reference, capturedAt) =>
      this.database.connectBit(result, reference, capturedAt));
  }

  connectEvm(result: EvmWatchAuthorizationResult) {
    return this.connectOrReplace("evm", result, (reference, capturedAt) =>
      this.database.connectEvm(result, reference, capturedAt));
  }

  async reconnectEvm(
    sourceId: string,
    result: EvmWatchAuthorizationResult,
  ): Promise<void> {
    await this.serialize(() => this.replaceExisting(sourceId, "evm", result));
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
  async replace(reference: string, value: string) {
    await this.ready;
    return this.secrets.replace(reference, value);
  }
  async remove(reference: string) {
    await this.ready;
    return this.secrets.remove(reference);
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

export class FileOwnerCredentialStore implements OwnerCredentialStore {
  constructor(private readonly filePath: string) {}

  async get(): Promise<OwnerCredential | null> {
    let raw: string;
    try {
      raw = await readPrivateFile(this.filePath);
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
    const value: unknown = JSON.parse(raw);
    if (!isOwnerCredential(value)) {
      throw new Error(`所有者凭证文件格式无效: ${this.filePath}`);
    }
    return value;
  }

  async save(credential: OwnerCredential): Promise<void> {
    await atomicWritePrivateFile(
      this.filePath,
      JSON.stringify(credential, null, 2),
    );
  }
}

function isOwnerRecoveryCredential(
  value: unknown,
): value is OwnerRecoveryCredential {
  if (typeof value !== "object" || value === null) return false;
  const credential = value as Record<string, unknown>;
  return (
    credential.version === 2 &&
    typeof credential.encryptedTotpSecret === "string" &&
    typeof credential.totpIv === "string" &&
    typeof credential.totpAuthTag === "string" &&
    (credential.lastUsedTotpCounter === null ||
      (typeof credential.lastUsedTotpCounter === "string" &&
        /^\d+$/u.test(credential.lastUsedTotpCounter)))
  );
}

function isLegacyOwnerRecoveryCredential(value: unknown): boolean {
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

export class FileOwnerRecoveryCredentialStore
  implements OwnerRecoveryCredentialStore
{
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  get(): Promise<OwnerRecoveryCredential | null> {
    return this.serialize(() => this.read());
  }

  private async read(): Promise<OwnerRecoveryCredential | null> {
    let raw: string;
    try {
      raw = await readPrivateFile(this.filePath);
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
    const value: unknown = JSON.parse(raw);
    if (isLegacyOwnerRecoveryCredential(value)) {
      await rm(this.filePath, { force: true });
      return null;
    }
    if (!isOwnerRecoveryCredential(value)) {
      throw new Error(`恢复认证文件格式无效: ${this.filePath}`);
    }
    return value;
  }

  save(credential: OwnerRecoveryCredential): Promise<void> {
    return this.serialize(() => atomicWritePrivateFile(
      this.filePath,
      JSON.stringify(credential, null, 2),
    ));
  }

  claimTotpCounter(counter: string): Promise<boolean> {
    return this.serialize(async () => {
      const credential = await this.read();
      if (!credential) return false;
      const previous = credential.lastUsedTotpCounter;
      if (previous !== null && BigInt(counter) <= BigInt(previous)) return false;
      await atomicWritePrivateFile(
        this.filePath,
        JSON.stringify({ ...credential, lastUsedTotpCounter: counter }, null, 2),
      );
      return true;
    });
  }
}

export function createProductionServices(
  dataDir = process.env.KANBAN_DATA_DIR?.trim() || path.join(process.cwd(), "data"),
): AppServices {
  hardenLocalDataPermissions(dataDir);
  const clock = new SystemClock();
  const database = new SqliteDashboardDatabase(
    path.join(dataDir, "dashboard.sqlite"),
    path.join(dataDir, "dashboard.json"),
    path.join(dataDir, "cards.json"),
  );
  const secrets = new FileEncryptedSecretStore(
    path.join(dataDir, "secrets.json"),
  );
  const secretRecovery = database.listSources().then(async (sources) => {
    await secrets.recover(
      new Set(
        sources.flatMap((source) =>
          source.credentialReference === null
            ? []
            : [source.credentialReference],
        ),
      ),
    );
  });
  void secretRecovery.catch(() => undefined);
  const assetSources = new DatabaseAssetSources(database);
  const manualAssetRecords = new DatabaseManualAssetRecords(database, clock);
  const investmentCashflows = new InvestmentCashflowLedger(
    database,
    assetSources,
    clock,
  );
  const dailyAssetSnapshots = new DatabaseDailyAssetSnapshots(database);
  const fullRefreshState = new DatabaseAssetFullRefreshState(database);
  const readySecrets = new ReadySecretStore(secrets, secretRecovery);
  const externalServices: ExternalServiceConfiguration =
    new FileExternalServiceConfiguration(
      path.join(dataDir, "external-services.json"),
      readySecrets,
    );
  const prices = new CoinGeckoUsdtUsdPrices(externalServices);
  const evmRefresher = new ProductionEvmWatchSourceRefresher(externalServices);
  const longbridge = new KeychainLongbridgeOAuth();
  const binance = new ProductionBinanceReadOnly(prices);
  const okx = new ProductionOkxReadOnly(prices);
  const bitget = new ProductionBitgetReadOnly(prices);
  const bit = new ProductionBitReadOnly(prices);
  const evm = new ProductionEvmWatchWallet(externalServices);
  const assetSourceConnections = new DatabaseAssetSourceConnections(
    database,
    secrets,
    secretRecovery,
    clock,
    fullRefreshState,
  );
  const assetSourceOnboarding = new AssetSourceOnboarding(
    createAssetSourceProviderAdapters({
      longbridge,
      binance,
      okx,
      bitget,
      bit,
      evm,
      connections: assetSourceConnections,
    }),
  );
  const sourceRefresher = new RoutedAssetSourceRefresher({
    longbridge: new KeychainLongbridgeSourceRefresher(),
    binance: new ProductionBinanceSourceRefresher(prices),
    okx: new ProductionOkxSourceRefresher(prices),
    bitget: new ProductionBitgetSourceRefresher(prices),
    bit: new ProductionBitSourceRefresher(prices),
    "evm-watch-ethereum": evmRefresher,
    "evm-watch-bsc": evmRefresher,
  });
  const formalDailySettlements = new DatabaseFormalDailySettlements(database);
  const formalSettlementExecutions = new DatabaseFormalSettlementExecutions(database);
  return {
    clock,
    assetCards: new DatabaseAssetCardStore(database),
    assetSources,
    assetSourceDetails: database,
    manualAssetRecords,
    investmentCashflows,
    assetSourceLifecycle: new DatabaseAssetSourceLifecycle(
      database,
      readySecrets,
      fullRefreshState,
    ),
    dailyAssetSnapshots,
    formalDailySettlements,
    formalSettlementExecutions,
    formalSettlementScheduler: new LocalFormalSettlementScheduler(undefined, { workspace: process.cwd(), dataDir }),
    formalDailySettlementRunner: new ObservedFormalSettlementRunner(new MarketCloseFormalDailySettlement(
      assetSources,
      clock,
      formalDailySettlements,
      new ReadOnlyFormalSettlementSourceCapture(readySecrets, sourceRefresher),
      new KeychainLongbridgeFormalSettlementCandleReader(),
    ), formalSettlementExecutions, clock),
    externalServices,
    assetSynchronization: new SourceIsolatedAssetSynchronization(
      assetSources,
      readySecrets,
      clock,
      sourceRefresher,
      60_000,
      dailyAssetSnapshots,
      fullRefreshState,
    ),
    assetFullRefreshState: fullRefreshState,
    prices,
    auth: new SessionOwnerAuth(clock),
    ownerCredentials: new FileOwnerCredentialStore(
      path.join(dataDir, "owner-credential.json"),
    ),
    ownerRecoveryCredentials: new FileOwnerRecoveryCredentialStore(
      path.join(dataDir, "owner-recovery.json"),
    ),
    secrets: readySecrets,
    longbridge,
    longbridgeBenchmarkCandlesticks: new KeychainLongbridgeBenchmarkCandlestickReader(),
    longbridgeHoldingCandlesticks: new KeychainLongbridgeHoldingCandlestickReader(),
    longbridgeOAuthState: new LongbridgeOAuthState(),
    binance,
    okx,
    bitget,
    bit,
    evm,
    assetSourceConnections,
    assetSourceOnboarding,
    businessDataBackups: new CredentialFreeBusinessDataBackup(
      database,
      path.join(dataDir, "backups"),
      clock,
    ),
  };
}
export { FileDashboardDatabase } from "@/server/persistence/json-database";

export { SqliteDashboardDatabase } from "@/server/persistence/sqlite-database";
