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
import { ServeLongbridgeBenchmarkCandlestickReader, ServeLongbridgeFormalSettlementCandleReader, ServeLongbridgeHoldingCandlestickReader, KeychainLongbridgeOAuth, LongbridgeOAuthState } from "@/server/asset-sources/longbridge";
import { ProductionOkxReadOnly, ProductionOkxSourceRefresher, } from "@/server/asset-sources/okx";
import { ServeLongbridgeSourceRefresher } from "@/server/asset-sources/longbridge-serve-assets";
import { RoutedAssetSourceRefresher } from "@/server/asset-sources/router";
import { SourceIsolatedAssetSynchronization } from "@/server/asset-synchronization";
import { SessionOwnerAuth } from "@/server/auth/session-auth";
import { CredentialFreeBusinessDataBackup } from "@/server/business-data-backup";
import type { AppServices } from "@/server/composition";
import { FileOwnerCredentialStore, FileOwnerRecoveryCredentialStore } from "@/server/credentials/owner-store";
import { FileEncryptedSecretStore, ReadySecretStore } from "@/server/credentials/secret-store";
import { FileExternalServiceConfiguration } from "@/server/external-service-configuration";
import { MarketCloseFormalDailySettlement, ReadOnlyFormalSettlementSourceCapture, } from "@/server/formal-daily-settlement";
import { InvestmentCashflowLedger } from "@/server/investment-cashflows";
import { hardenLocalDataPermissions } from "@/server/local-data-permissions";
import { DatabaseAssetCardStore, DatabaseAssetFullRefreshState, DatabaseAssetSources, DatabaseDailyAssetSnapshots, DatabaseFormalDailySettlements, DatabaseFormalSettlementExecutions, DatabaseManualAssetRecords } from "@/server/persistence/adapters";
import { SqliteDashboardDatabase } from "@/server/persistence/sqlite-database";
import type { ExternalServiceConfiguration } from "@/server/ports";
import { DatabaseAssetSourceConnections, DatabaseAssetSourceLifecycle } from "@/server/source-connections";

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
  const externalServices: ExternalServiceConfiguration =
    new FileExternalServiceConfiguration(
      path.join(dataDir, "external-services.json"),
      readySecrets,
    );
  const prices = new CoinGeckoUsdtUsdPrices(externalServices);
  const evmRefresher = new ProductionEvmWatchSourceRefresher(externalServices);
  const longbridgeAssets = new ServeLongbridgeSourceRefresher();
  const longbridge = new KeychainLongbridgeOAuth(undefined, (at) => longbridgeAssets.readSnapshot(at));
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
    longbridge: longbridgeAssets,
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
      new ServeLongbridgeFormalSettlementCandleReader(),
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
    longbridgeBenchmarkCandlesticks: new ServeLongbridgeBenchmarkCandlestickReader(),
    longbridgeHoldingCandlesticks: new ServeLongbridgeHoldingCandlestickReader(),
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
export { DatabaseAssetFullRefreshState } from "@/server/persistence/adapters";

export { DatabaseFormalSettlementExecutions } from "@/server/persistence/adapters";

export { DatabaseFormalDailySettlements } from "@/server/persistence/adapters";

export { FileEncryptedSecretStore } from "@/server/credentials/secret-store";

export { DatabaseAssetSourceConnections } from "@/server/source-connections";

export { FileOwnerCredentialStore } from "@/server/credentials/owner-store";

export { FileOwnerRecoveryCredentialStore } from "@/server/credentials/owner-store";

export { FileDashboardDatabase } from "@/server/persistence/json-database";

export { SqliteDashboardDatabase } from "@/server/persistence/sqlite-database";
