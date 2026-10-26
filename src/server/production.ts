import { longbridgePluginClient } from "@/server/asset-source-plugins/longbridge-client";
import { pluginReferencePrices, pluginConfigurationVerifier } from "@/server/asset-source-plugins/service-client";
import { PluginDistribution } from "@/server/asset-source-plugins/distribution";
import { BackgroundAssetCollection } from "@/server/background-collection";
import { SystemClock } from "@/server/clock";
import { ObservedFormalSettlementRunner } from "@/server/settlement/formal-settlement-execution";
import { LocalFormalSettlementScheduler } from "@/server/settlement/formal-settlement-scheduler";
import path from "node:path";
import { LongbridgeDailyAssets } from "@/server/asset-sources/longbridge-daily-assets";
import { existsSync } from "node:fs";

import { AssetSourceOnboarding } from "@/server/asset-source-onboarding";
import { pluginPackageLoader, pluginRoot } from "@/server/asset-source-plugins/registry";
import { stdioAssetSourcePlugin } from "@/server/asset-source-plugins/stdio-host";
import { LongbridgeOAuthState } from "@/server/asset-source-plugins/oauth-state";
import { AssetSourcePluginManager } from "@/server/asset-source-plugins/manager";
import { SourceIsolatedAssetSynchronization } from "@/server/refresh/asset-synchronization";
import { SessionOwnerAuth } from "@/server/auth/session-auth";
import { CredentialFreeBusinessDataBackup } from "@/server/backup/business-data-backup";
import type { ProductionAppServices } from "@/server/app-services";
import { FileOwnerCredentialStore, FileOwnerRecoveryCredentialStore } from "@/server/credentials/owner-store";
import { FileEncryptedSecretStore, ReadySecretStore } from "@/server/credentials/secret-store";
import { FileExternalServiceConfiguration } from "@/server/credentials/external-service-store";
import { MarketCloseFormalDailySettlement, ReadOnlyFormalSettlementSourceCapture, } from "@/server/settlement/formal-daily-settlement";
import { InvestmentCashflowLedger } from "@/server/investment-cashflows";
import { hardenLocalDataPermissions } from "@/server/local-data-permissions";
import { DatabaseAssetCardStore, DatabaseAssetFullRefreshState, DatabaseAssetSources, DatabaseDailyAssetSnapshots, DatabaseFormalDailySettlements, DatabaseFormalSettlementExecutions, DatabaseManualAssetRecords } from "@/server/persistence/adapters";
import { SqliteDashboardDatabase } from "@/server/persistence/sqlite-database";
import type { ExternalServiceConfiguration } from "@/server/ports";
import { DatabaseAssetSourceConnections, DatabaseAssetSourceLifecycle } from "@/server/source-connections";

export function createProductionServices(
  dataDir = process.env.KANBAN_DATA_DIR?.trim() || path.join(process.cwd(), "data"),
): ProductionAppServices {
  hardenLocalDataPermissions(dataDir);
  const databasePath = path.join(dataDir, "dashboard.sqlite");
  const legacyDashboardPath = path.join(dataDir, "dashboard.json");
  const legacyCardsPath = path.join(dataDir, "cards.json");
  if (
    !existsSync(databasePath) &&
    (existsSync(legacyDashboardPath) || existsSync(legacyCardsPath))
  ) {
    throw new Error(
      `检测到旧 JSON 业务数据，已停止启动；请先运行 migrate:json-to-sqlite ${databasePath} ${legacyDashboardPath} ${legacyCardsPath}`,
    );
  }
  const clock = new SystemClock();
  const database = new SqliteDashboardDatabase(
    databasePath,
  );
  const secrets = new FileEncryptedSecretStore(
    path.join(dataDir, "secrets.json"),
  );
  const secretRecovery = secrets.recover(async () =>
    new Set(
      (await database.listSources()).flatMap((source) =>
        source.credentialReference === null
          ? []
          : [source.credentialReference],
      ),
    ),
  );
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
  const packages = pluginPackageLoader(pluginRoot(dataDir));
  const pluginManagement = new PluginDistribution(pluginRoot(dataDir));
  const externalServices: ExternalServiceConfiguration =
    new FileExternalServiceConfiguration(
      path.join(dataDir, "external-services.json"),
      readySecrets,
      pluginConfigurationVerifier(packages),
    );
  const prices = pluginReferencePrices(packages, externalServices);
  const longbridgeRuntime = longbridgePluginClient(() => packages().find(p => p.manifest.id === "longbridge"), database);
  const longbridge = longbridgeRuntime.client;
  const longbridgeDailyAssets = new LongbridgeDailyAssets(database, dataDir, clock, longbridge.readDailyAsset.bind(longbridge));
  const assetSourceConnections = new DatabaseAssetSourceConnections(
    database,
    secrets,
    secretRecovery,
    clock,
    fullRefreshState,
  );
  const sourceRefresher = new AssetSourcePluginManager(() => {
    const longbridgePlugin = longbridgeRuntime.plugin;
    return [
    ...(longbridgePlugin ? [longbridgePlugin] : []),
    ...packages().filter(p => p.manifest.id !== "longbridge" && p.manifest.capabilities.includes("assets.read"))
      .map(pkg => stdioAssetSourcePlugin(pkg, prices, externalServices)),
  ]; });
  const assetSourceOnboarding = new AssetSourceOnboarding(
    () => sourceRefresher.providerAdapters(assetSourceConnections.connectPlugin.bind(assetSourceConnections)),
  );
  const formalDailySettlements = new DatabaseFormalDailySettlements(database);
  const formalSettlementExecutions = new DatabaseFormalSettlementExecutions(database);
  const assetSynchronization = new SourceIsolatedAssetSynchronization(
    assetSources, readySecrets, clock, sourceRefresher, 60_000, dailyAssetSnapshots, fullRefreshState, longbridgeDailyAssets,
  );
  const formalDailySettlementRunner = new ObservedFormalSettlementRunner(new MarketCloseFormalDailySettlement(
    assetSources, clock, formalDailySettlements,
    new ReadOnlyFormalSettlementSourceCapture(readySecrets, sourceRefresher, 60_000, assetSources),
    longbridge.settlementCandles,
    undefined, longbridge.tradingCalendar,
  ), formalSettlementExecutions, clock);
  return {
    backgroundCollection: new BackgroundAssetCollection(database, assetSources, dailyAssetSnapshots, fullRefreshState, assetSynchronization, formalDailySettlementRunner, clock, longbridgeDailyAssets, longbridge),
    clock,
    assetCards: new DatabaseAssetCardStore(database),
    assetSources,
    assetSourceDetails: database,
    investmentBooks: database,
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
    formalDailySettlementRunner,
    externalServices,
    assetSynchronization,
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
    longbridgeConnections: longbridge,
    longbridgeBenchmarkCandlesticks: longbridge.benchmarkCandlesticks,
    longbridgeHoldingCandlesticks: longbridge.holdingCandlesticks,
    longbridgeOAuthState: new LongbridgeOAuthState(),
    assetSourceConnections,
    assetSourceOnboarding,
    assetSourcePlugins: sourceRefresher,
    pluginManagement,
    businessDataBackups: new CredentialFreeBusinessDataBackup(
      database,
      path.join(dataDir, "backups"),
      clock,
    ),
  };
}
export { DatabaseAssetFullRefreshState } from "@/server/persistence/adapters";

export { DatabaseFormalSettlementExecutions } from "@/server/persistence/adapters";

export { DatabaseFormalDailySettlements } from "@/server/persistence/adapters";

export { FileEncryptedSecretStore } from "@/server/credentials/secret-store";

export { DatabaseAssetSourceConnections } from "@/server/source-connections";

export { FileOwnerCredentialStore } from "@/server/credentials/owner-store";

export { FileOwnerRecoveryCredentialStore } from "@/server/credentials/owner-store";

export { SqliteDashboardDatabase } from "@/server/persistence/sqlite-database";
