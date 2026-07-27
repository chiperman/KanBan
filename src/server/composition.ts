import type {
  AssetSources,
  AssetSourceLifecycle,
  AssetSynchronization,
  AssetSourceConnections,
  BinanceReadOnly,
  BitgetReadOnly,
  EvmWatchWalletReadOnly,
  OkxReadOnly,
  AssetCardStore,
  Clock,
  DailyAssetSnapshots,
  LongbridgeOAuth,
  OwnerAuth,
  OwnerCredentialStore,
  OwnerRecoveryCredentialStore,
  Prices,
  SecretStore,
} from "@/server/ports";
import { createProductionServices } from "@/server/production";
import { clearAllSessions } from "@/server/auth/session";
import { LongbridgeConnectionState } from "@/server/asset-sources/longbridge";
import { BinanceConnectionState } from "@/server/asset-sources/binance";
import { OkxConnectionState } from "@/server/asset-sources/okx";
import { BitgetConnectionState } from "@/server/asset-sources/bitget";
import { EvmConnectionState } from "@/server/asset-sources/ethereum";
import type { BusinessDataBackup } from "@/server/business-data-backup";
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
  dailyAssetSnapshots: DailyAssetSnapshots;
  prices: Prices;
  auth: OwnerAuth;
  ownerCredentials: OwnerCredentialStore;
  ownerRecoveryCredentials: OwnerRecoveryCredentialStore;
  secrets: SecretStore;
  longbridge: LongbridgeOAuth;
  longbridgeConnections: LongbridgeConnectionState;
  binance: BinanceReadOnly;
  binanceConnections: BinanceConnectionState;
  okx: OkxReadOnly;
  okxConnections: OkxConnectionState;
  bitget: BitgetReadOnly;
  bitgetConnections: BitgetConnectionState;
  evm: EvmWatchWalletReadOnly;
  evmConnections: EvmConnectionState;
  assetSourceConnections: AssetSourceConnections;
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

export function getServices(): AppServices {
  const current = slot();
  current.current ??= isTestEnv()
    ? createTestServices()
    : createProductionServices();
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
