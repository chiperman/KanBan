import type {
  AssetSources,
  AssetSourceLifecycle,
  AssetSynchronization,
  AssetSourceConnections,
  AssetFullRefreshState,
  ManualAssetRecords,
  BitReadOnly,
  BinanceReadOnly,
  BitgetReadOnly,
  EvmWatchWalletReadOnly,
  OkxReadOnly,
  AssetCardStore,
  Clock,
  DailyAssetSnapshots,
  ExternalServiceConfiguration,
  FormalDailySettlementRunner,
  FormalDailySettlements,
  InvestmentCashflows,
  LongbridgeBenchmarkCandlestickReader,
  LongbridgeHoldingCandlestickReader,
  LongbridgeOAuth,
  OwnerAuth,
  OwnerCredentialStore,
  OwnerRecoveryCredentialStore,
  Prices,
  SecretStore,
} from "@/server/ports";
import { createProductionServices } from "@/server/production";
import { clearAllSessions } from "@/server/auth/session";
import { LongbridgeOAuthState } from "@/server/asset-sources/longbridge";
import type { BusinessDataBackup } from "@/server/business-data-backup";
import type { AssetSourceOnboarding } from "@/server/asset-source-onboarding";
import {
  createTestServices,
  type TestServices,
} from "@/server/testing/fakes";

export type { Card } from "@/server/ports";

/** 应用服务组合根：所有系统边界端口在此装配。 */
export interface AppServices {
  clock: Clock;
  assetCards: AssetCardStore;
  assetSources: AssetSources;
  assetSourceLifecycle: AssetSourceLifecycle;
  assetSynchronization: AssetSynchronization;
  assetFullRefreshState: AssetFullRefreshState;
  dailyAssetSnapshots: DailyAssetSnapshots;
  formalDailySettlements: FormalDailySettlements;
  formalDailySettlementRunner: FormalDailySettlementRunner;
  externalServices: ExternalServiceConfiguration;
  prices: Prices;
  auth: OwnerAuth;
  ownerCredentials: OwnerCredentialStore;
  ownerRecoveryCredentials: OwnerRecoveryCredentialStore;
  secrets: SecretStore;
  longbridge: LongbridgeOAuth;
  longbridgeBenchmarkCandlesticks: LongbridgeBenchmarkCandlestickReader;
  longbridgeHoldingCandlesticks: LongbridgeHoldingCandlestickReader;
  longbridgeOAuthState: LongbridgeOAuthState;
  binance: BinanceReadOnly;
  okx: OkxReadOnly;
  bitget: BitgetReadOnly;
  bit: BitReadOnly;
  evm: EvmWatchWalletReadOnly;
  assetSourceConnections: AssetSourceConnections;
  manualAssetRecords: ManualAssetRecords;
  investmentCashflows: InvestmentCashflows;
  assetSourceOnboarding: AssetSourceOnboarding;
  businessDataBackups: BusinessDataBackup;
}

const GLOBAL_KEY = "__personal_asset_dashboard_services__";

type ServicesSlot = { current: AppServices | null };

function slot(): ServicesSlot {
  const globalScope = globalThis as unknown as Record<
    string,
    ServicesSlot | undefined
  >;
  globalScope[GLOBAL_KEY] ??= { current: null };
  return globalScope[GLOBAL_KEY];
}

export function isTestEnv(): boolean {
  return process.env.APP_ENV === "test";
}

function hasCurrentServices(
  services: AppServices | null,
): services is AppServices {
  return (
    services !== null &&
    services.externalServices !== undefined &&
    typeof services.dailyAssetSnapshots
      .listImportedSourceHistoryObservations === "function" &&
    services.longbridgeBenchmarkCandlesticks !== undefined &&
    services.longbridgeHoldingCandlesticks !== undefined &&
    typeof services.longbridgeHoldingCandlesticks.readFiveDayTrend === "function" &&
    typeof services.assetSourceLifecycle.setEvmTokenPreference === "function" &&
    typeof services.manualAssetRecords.record === "function" &&
    typeof services.investmentCashflows?.create === "function" &&
    typeof services.assetSourceOnboarding?.reauthorize === "function"
  );
}

export function getServices(): AppServices {
  const current = slot();
  if (!hasCurrentServices(current.current)) {
    current.current = isTestEnv()
      ? createTestServices()
      : createProductionServices();
  }
  return current.current;
}

/** 仅供测试路由使用：非测试环境下调用即失败。 */
export function getTestServices(): TestServices {
  if (!isTestEnv()) {
    throw new Error("测试替身仅在 APP_ENV=test 时可用");
  }
  return getServices() as TestServices;
}

/** 重建全部测试替身，使每条浏览器测试从干净状态开始。 */
export function resetTestServices(): void {
  if (!isTestEnv()) {
    throw new Error("测试替身仅在 APP_ENV=test 时可用");
  }
  slot().current = createTestServices();
  clearAllSessions();
}
