import { redirect } from "next/navigation";

import {
  redirectLoopbackIpToLocalhost,
  type PageSearchParams,
} from "@/server/auth/canonical-origin";
import { getServices } from "@/server/composition";
import {
  buildTotalValuation,
  convertCurrencyAmount,
  type ReportingCurrency,
} from "@/domain/valuation";
import { hasManualAssetRecord } from "@/domain/manual-asset-records";
import { shanghaiDay } from "@/domain/daily-asset-snapshots";
import {
  longbridgeReferenceRates,
  type PortfolioObservation,
} from "@/domain/investment-performance";
import { InvestmentPerformanceWorkspace } from "@/ui/investment-performance-workspace";
import { SessionGuard } from "@/ui/session-guard";
import { WorkbenchShell } from "@/ui/workbench-shell";

export const dynamic = "force-dynamic";

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: PageSearchParams;
}) {
  await redirectLoopbackIpToLocalhost("/performance", searchParams);
  const services = getServices();
  if ((await services.auth.currentSession()) === null) redirect("/");
  const now = services.clock.now();
  const [cashflows, sources, trendObservations] = await Promise.all([
    services.investmentCashflows.list(),
    services.assetSources.list(),
    services.dailyAssetSnapshots.listTrendObservations(),
  ]);
  const usdValuation = buildTotalValuation(sources, "USD", "source");
  const longbridgeRates = longbridgeReferenceRates(sources);
  const recordedSources = sources.filter(hasManualAssetRecord);
  const currentTotals = (["USD", "CNY", "HKD"] as const).reduce(
    (totals, currency) => {
      const amount = usdValuation.amount === null
        ? null
        : currency === "USD"
          ? usdValuation.amount
          : convertCurrencyAmount(
            usdValuation.amount,
            "USD",
            currency,
            longbridgeRates,
          );
      const complete =
        amount !== null &&
        usdValuation.incomplete === false &&
        usdValuation.expiredCount === 0 &&
        recordedSources.length > 0 &&
        recordedSources.every(
          (source) =>
            source.lifecycle !== "disconnected" &&
            source.sync.status === "current",
        );
      totals[currency] = amount === null
        ? null
        : {
            amount,
            complete,
            observedAt: now.toISOString(),
          };
      return totals;
    },
    {} as Record<ReportingCurrency, PortfolioObservation | null>,
  );

  return (
    <SessionGuard>
      <WorkbenchShell
        refreshEnabled={sources.some(
          (source) =>
            source.lifecycle !== "disconnected" && source.kind !== "manual",
        )}
      >
        <div className="page page-workbench-destination">
          <a className="skip-link" href="#main-content">
            跳到主要内容
          </a>
          <main id="main-content">
            <InvestmentPerformanceWorkspace
              cashflows={cashflows}
              currentDay={shanghaiDay(now)}
              currentObservedAt={now.toISOString()}
              currentTotals={currentTotals}
              trendObservations={trendObservations}
            />
          </main>
        </div>
      </WorkbenchShell>
    </SessionGuard>
  );
}
