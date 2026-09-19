import { SystemClock } from "@/server/clock";
import { ObservedFormalSettlementRunner } from "@/server/formal-settlement-execution";
import { LocalFormalSettlementScheduler } from "@/server/formal-settlement-scheduler";
import path from "node:path";

import { AssetSourceOnboarding } from "@/server/asset-source-onboarding";
import { createAssetSourceProviderAdapters } from "@/server/asset-source-provider-adapters";
import { CoinGeckoUsdtUsdPrices, ProductionBinanceReadOnly, ProductionBinanceSourceRefresher, } from "@/server/asset-sources/binance";
import { ProductionBitReadOnly, ProductionBitSourceRefresher, } from "@/server/asset-sources/bit";
import { ProductionBitgetReadOnly, ProductionBitgetSourceRefresher, } from "@/server/asset-sources/bitget";
import { ProductionEvmWatchSourceRefresher, ProductionEvmWatchWallet, } from "@/server/asset-sources/ethereum";
import { KeychainLongbridgeBenchmarkCandlestickReader, KeychainLongbridgeFormalSettlementCandleReader, KeychainLongbridgeHoldingCandlestickReader, KeychainLongbridgeOAuth, KeychainLongbridgeSourceRefresher, LongbridgeOAuthState } from "@/server/asset-sources/longbridge";
import { ProductionOkxReadOnly, ProductionOkxSourceRefresher, } from "@/server/asset-sources/okx";
import { RoutedAssetSourceRefresher } from "@/server/asset-sources/router";
import { SourceIsolatedAssetSynchronization } from "@/server/asset-synchronization";
import { SessionOwnerAuth } from "@/server/auth/session-auth";
import { CredentialFreeBusinessDataBackup } from "@/server/business-data-backup";
import type { AppServices, Card, } from "@/server/composition";
import { FileOwnerCredentialStore, FileOwnerRecoveryCredentialStore } from "@/server/credentials/owner-store";
import { FileEncryptedSecretStore, ReadySecretStore } from "@/server/credentials/secret-store";
import { FileExternalServiceConfiguration } from "@/server/external-service-configuration";
import { MarketCloseFormalDailySettlement, ReadOnlyFormalSettlementSourceCapture, } from "@/server/formal-daily-settlement";
import { InvestmentCashflowLedger } from "@/server/investment-cashflows";
import { hardenLocalDataPermissions } from "@/server/local-data-permissions";
import type { DashboardDatabase } from "@/server/persistence/contracts";
import { SqliteDashboardDatabase } from "@/server/persistence/sqlite-database";
import type { AssetCardStore, AssetFullRefreshState, AssetSources, AssetSourceSummary, Clock, CreateManualAssetSourceInput, DailyAssetSnapshot, DailyAssetSnapshots, DailyAssetTrendObservation, ExternalServiceConfiguration, FormalDailySettlement, FormalDailySettlements, FormalSettlementExecution, FormalSettlementExecutions, ManualAssetRecord, ManualAssetRecordInput, ManualAssetRecords } from "@/server/ports";
import { DatabaseAssetSourceConnections, DatabaseAssetSourceLifecycle } from "@/server/source-connections";

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
export { FileEncryptedSecretStore } from "@/server/credentials/secret-store";

export { DatabaseAssetSourceConnections } from "@/server/source-connections";

export { FileOwnerCredentialStore } from "@/server/credentials/owner-store";

export { FileOwnerRecoveryCredentialStore } from "@/server/credentials/owner-store";

export { FileDashboardDatabase } from "@/server/persistence/json-database";

export { SqliteDashboardDatabase } from "@/server/persistence/sqlite-database";
