import type { AppServices } from "@/server/app-services";
import { createProductionServices } from "@/server/production";

export type { Card } from "@/server/ports";
export type { AppServices } from "@/server/app-services";

const GLOBAL_KEY = "__personal_asset_dashboard_services__";

type ServicesSlot = { current: AppServices | null; testFactory?: () => AppServices };

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
    typeof services.investmentBooks?.readInvestmentBooks === "function" &&
    hasDetails &&
    services.externalServices !== undefined &&
    typeof services.formalSettlementExecutions?.latest === "function" &&
    typeof services.formalSettlementScheduler?.read === "function" &&
    typeof services.dailyAssetSnapshots
      .listImportedSourceHistoryObservations === "function" &&
    services.longbridgeBenchmarkCandlesticks !== undefined &&
    services.longbridgeHoldingCandlesticks !== undefined &&
    typeof services.longbridgeHoldingCandlesticks.readFiveDayTrend === "function" &&
    (isTestEnv() || (
      typeof services.longbridgeConnections?.status === "function" &&
      typeof services.longbridgeConnections.subscribeQuotes === "function"
    )) &&
    typeof services.assetSourceLifecycle.setEvmTokenPreference === "function" &&
    typeof services.manualAssetRecords.record === "function" &&
    typeof services.investmentCashflows?.create === "function" &&
    typeof services.assetSourceOnboarding?.reauthorize === "function"
  );
}

export function getServices(): AppServices {
  const current = slot();
  if (!hasCurrentServices(current.current)) {
    if (isTestEnv()) {
      if (!current.testFactory) throw new Error("测试服务尚未初始化");
      current.current = current.testFactory();
    } else {
      current.current = createProductionServices();
    }
  }
  return current.current;
}

/** 测试入口注入工厂；公共组合根不加载测试替身及供应商实现。 */
export function configureTestServices(factory: () => AppServices, reset = false): void {
  if (!isTestEnv()) {
    throw new Error("测试替身仅在 APP_ENV=test 时可用");
  }
  const current = slot();
  current.testFactory = factory;
  if (reset) current.current = factory();
}
