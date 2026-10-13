import type { AppServices } from "@/server/app-services";
import { createProductionServices } from "@/server/production";
import { clearAllSessions } from "@/server/auth/session";
import {
  createTestServices,
  type TestServices,
} from "@/server/testing/fakes";

export type { Card } from "@/server/ports";
export type { AppServices } from "@/server/app-services";

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
  if (services === null) return false;
  const details = services.assetSourceDetails;
  const hasDetails =
    typeof details?.readSourceDetail === "function" &&
    typeof details?.listSourceInvestmentHistories === "function" &&
    typeof details?.listSourceInvestmentRecords === "function" &&
    typeof details?.saveSourceInvestmentRecord === "function" &&
    typeof details?.deleteSourceInvestmentRecord === "function";
  return (
    (hasDetails || (isTestEnv() && details === undefined)) &&
    services.externalServices !== undefined &&
    typeof services.formalSettlementExecutions?.latest === "function" &&
    typeof services.formalSettlementScheduler?.read === "function" &&
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
