import { redirect } from "next/navigation";
import {
  redirectLoopbackIpToLocalhost,
  type PageSearchParams,
} from "@/server/auth/canonical-origin";
import { getServices } from "@/server/composition";
import { readAssetRefreshState } from "@/server/refresh/asset-refresh-state";
import { assetRefreshRegistration, readProfitColorScheme } from "@/server/workbench-pages";
import { shanghaiDay } from "@/domain/daily-asset-snapshots";
import {
  longbridgeReferenceRates,
} from "@/domain/investment-performance";
import { InvestmentPerformanceWorkspace } from "@/ui/investment-performance-workspace";
import { InvestmentBooksWorkspace } from "@/ui/investment-books-workspace";
import { INVESTMENT_BOOKS } from "@/domain/investment-books";
import { SessionGuard } from "@/ui/session-guard";
import { WorkbenchShell } from "@/ui/workbench-shell";
import { WorkbenchPage } from "@/ui/workbench-page";

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
    books,
    manualRecords,
  ] = await Promise.all([
    services.investmentCashflows.list(),
    services.assetSources.list(),
    services.dailyAssetSnapshots.listTrendObservations(),
    services.dailyAssetSnapshots.listImportedSourceHistoryObservations(),
    readAssetRefreshState(services),
    services.investmentBooks?.readInvestmentBooks() ?? null,
    services.manualAssetRecords.list(),
  ]);
  const query = await searchParams;
  const initialBook = INVESTMENT_BOOKS.find(book => book.id === query?.book)?.id;
  const longbridgeRates = longbridgeReferenceRates(sources);
  const profitColorScheme = await readProfitColorScheme();

  return (
    <SessionGuard>
      <WorkbenchShell
        refreshEnabled
        refreshRegistration={assetRefreshRegistration(fullRefreshState, sources)}
      >
        <WorkbenchPage className="page-workbench-destination">
          {books ? <InvestmentBooksWorkspace
              state={books}
              key={initialBook ?? "us-stocks"}
              initialBookId={initialBook}
              view={query?.view === "records" || query?.view === "manage" ? "records" : "performance"}
              sources={sources.map(({ credentialReference: _credential, permissions: _permissions, ...source }) => source)}
              observations={trendObservations}
              manualRecords={manualRecords}
              cashflows={cashflows}
              currentDay={shanghaiDay(now)}
            /> : <InvestmentPerformanceWorkspace
              cashflows={cashflows}
              currentDay={shanghaiDay(now)}
              currentObservedAt={now.toISOString()}
              profitColorScheme={profitColorScheme}
              sources={sources.map(({ credentialReference: _credential, permissions: _permissions, ...source }) => source)}
              currentExchangeRates={longbridgeRates}
              importedSourceHistoryObservations={importedSourceHistoryObservations}
              trendObservations={trendObservations}
            />}
        </WorkbenchPage>
      </WorkbenchShell>
    </SessionGuard>
  );
}
