import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import {
  redirectLoopbackIpToLocalhost,
  type PageSearchParams,
} from "@/server/auth/canonical-origin";
import { getServices } from "@/server/composition";
import { readAssetRefreshState } from "@/server/asset-refresh-state";
import { shanghaiDay } from "@/domain/daily-asset-snapshots";
import {
  longbridgeReferenceRates,
} from "@/domain/investment-performance";
import { InvestmentPerformanceWorkspace } from "@/ui/investment-performance-workspace";
import {
  DEFAULT_PROFIT_COLOR_SCHEME,
  isProfitColorScheme,
  PROFIT_COLOR_SCHEME_COOKIE_KEY,
} from "@/ui/profit-color-scheme";
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
  const [
    cashflows,
    sources,
    trendObservations,
    importedSourceHistoryObservations,
    fullRefreshState,
  ] = await Promise.all([
    services.investmentCashflows.list(),
    services.assetSources.list(),
    services.dailyAssetSnapshots.listTrendObservations(),
    services.dailyAssetSnapshots.listImportedSourceHistoryObservations(),
    readAssetRefreshState(services),
  ]);
  const longbridgeRates = longbridgeReferenceRates(sources);
  const savedProfitColorScheme =
    (await cookies()).get(PROFIT_COLOR_SCHEME_COOKIE_KEY)?.value ?? null;
  const profitColorScheme = isProfitColorScheme(savedProfitColorScheme)
    ? savedProfitColorScheme
    : DEFAULT_PROFIT_COLOR_SCHEME;

  return (
    <SessionGuard>
      <WorkbenchShell
        refreshEnabled
        refreshRegistration={{
          ...fullRefreshState,
          sources: sources.map((source) => ({
            id: source.id,
            kind: source.kind,
            lifecycle: source.lifecycle,
            credentialAvailable: source.credentialReference !== null,
          })),
        }}
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
              profitColorScheme={profitColorScheme}
              sources={sources.map(({ credentialReference: _credential, permissions: _permissions, ...source }) => source)}
              currentExchangeRates={longbridgeRates}
              importedSourceHistoryObservations={importedSourceHistoryObservations}
              trendObservations={trendObservations}
            />
          </main>
        </div>
      </WorkbenchShell>
    </SessionGuard>
  );
}
