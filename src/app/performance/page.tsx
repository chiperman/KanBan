import { redirect } from "next/navigation";
import {
  redirectLoopbackIpToLocalhost,
  type PageSearchParams,
} from "@/server/auth/canonical-origin";
import { getServices } from "@/server/composition";
import { readAssetRefreshState } from "@/server/refresh/asset-refresh-state";
import { assetRefreshRegistration } from "@/server/workbench-pages";
import { shanghaiDay } from "@/domain/daily-asset-snapshots";
import { parseManualAssetRecordDay } from "@/domain/manual-asset-records";
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
    fullRefreshState,
    books,
    manualRecords,
  ] = await Promise.all([
    services.investmentCashflows.list(),
    services.assetSources.list(),
    services.dailyAssetSnapshots.listTrendObservations(),
    readAssetRefreshState(services),
    services.investmentBooks.readInvestmentBooks(),
    services.manualAssetRecords.list(),
  ]);
  const query = await searchParams;
  const initialBook = INVESTMENT_BOOKS.find(book => book.id === query?.book)?.id;
  const initialRecordFilter = query?.recordFilter === "valuations" || query?.recordFilter === "all" ? query.recordFilter : "funds";
  let initialRecordDay: string | undefined;
  try {
    const day = parseManualAssetRecordDay(query?.recordDay);
    if (day <= shanghaiDay(now)) initialRecordDay = day;
  } catch { /* 无效核对日期沿用全部历史，不据此判断记录缺失。 */ }

  return (
    <SessionGuard>
      <WorkbenchShell
        refreshEnabled
        refreshRegistration={assetRefreshRegistration(fullRefreshState, sources)}
      >
        <WorkbenchPage className="page-workbench-destination">
          <InvestmentBooksWorkspace
              state={books}
              key={initialBook ?? "us-stocks"}
              initialBookId={initialBook}
              initialRecordFilter={initialRecordFilter}
              initialRecordDay={initialRecordDay}
              checkSourceId={typeof query?.recordSource === "string" ? query.recordSource : undefined}
              view={query?.view === "records" || query?.view === "manage" ? "records" : "performance"}
              sources={sources.map(({ credentialReference: _credential, permissions: _permissions, ...source }) => source)}
              observations={trendObservations}
              manualRecords={manualRecords}
              cashflows={cashflows}
              currentDay={shanghaiDay(now)}
            />
        </WorkbenchPage>
      </WorkbenchShell>
    </SessionGuard>
  );
}
