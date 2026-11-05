import { rangeDays, type InvestmentPerformanceIntervalPreset } from "@/domain/investment-performance-trend";
import { notFound, redirect } from "next/navigation";

import { shanghaiDay } from "@/domain/daily-asset-snapshots";
import { longbridgeReferenceRates } from "@/domain/investment-performance";
import { manualSourceBookAssetHistory } from "@/domain/investment-books";
import {
  redirectLoopbackIpToLocalhost,
  type PageSearchParams,
} from "@/server/auth/canonical-origin";
import { getServices } from "@/server/composition";
import { readAssetRefreshState } from "@/server/refresh/asset-refresh-state";
import { assetRefreshRegistration, readProfitColorScheme } from "@/server/workbench-pages";
import { AssetSourceDetail } from "@/ui/asset-source-detail";
import { SessionGuard } from "@/ui/session-guard";
import { WorkbenchShell } from "@/ui/workbench-shell";
import { WorkbenchPage } from "@/ui/workbench-page";

export const dynamic = "force-dynamic";

export default async function AssetSourceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: PageSearchParams;
}) {
  const { id } = await params;
  await redirectLoopbackIpToLocalhost(
    `/asset-sources/${encodeURIComponent(id)}`,
    searchParams,
  );

  const services = getServices();
  if ((await services.auth.currentSession()) === null) redirect("/");
  const currentDay = shanghaiDay(services.clock.now());
  const query = await searchParams;
  const value = query?.interval;
  const preset: InvestmentPerformanceIntervalPreset = typeof value === "string" && ["7d", "month-to-date", "1m", "6m", "year-to-date", "1y", "all", "custom"].includes(value) ? value as InvestmentPerformanceIntervalPreset : "all";
  function validDay(value: unknown): value is string {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value && value <= currentDay;
  }
  const customRange = preset === "custom" && validDay(query?.from) && validDay(query?.to) && query.from <= query.to ? {startDay: query.from, endDay: query.to} : null;
  const effectivePreset = preset === "custom" && !customRange ? "all" : preset;
  const days = rangeDays(effectivePreset, currentDay, undefined, customRange);
  const detailQuery = { sourceId: id, ...(effectivePreset === "all" ? {} : {from: days[0], to: days.at(-1)}) };
  const [detail, fullRefreshState, books] = await Promise.all([
    services.assetSourceDetails.readSourceDetail(detailQuery),
    readAssetRefreshState(services),
    services.investmentBooks.readInvestmentBooks(),
  ]);
  const { sources, manualRecords, history } = detail;
  const storedSource = sources.find((source) => source.id === id);
  if (!storedSource) notFound();

  const { credentialReference: _credentialReference, ...source } = storedSource;
  const records = source.kind === "manual"
    ? manualRecords.filter((record) => record.sourceId === source.id)
    : [];
  const trendHistory = manualSourceBookAssetHistory({
    state: books, sourceId: id, sources, observations: history, manualRecords, currentDay,
  });
  const reportingExchangeRates = longbridgeReferenceRates(sources);
  const profitColorScheme = await readProfitColorScheme();

  return (
    <SessionGuard>
      <WorkbenchShell
        refreshEnabled={false}
        refreshRegistration={assetRefreshRegistration(fullRefreshState, sources)}
      >
        <WorkbenchPage className="page-workbench-destination page-asset-source-detail">
            <AssetSourceDetail
              key={source.id}
              view={query?.view === "manage" ? "manage" : "overview"}
              initialUpdate={query?.action === "update"}
              checkRecordDay={validDay(query?.checkDay) ? query.checkDay : undefined}
              bookId={books.members.find(member => member.sourceId === id)?.bookId}
              showAssetTrend={source.kind !== "manual" || source.hasManualRecord !== false ||
                detail.investmentRecords.length > 0 || detail.investmentHistory != null}
              initialPreset={effectivePreset}
              initialCustomRange={customRange}
              firstDay={trendHistory?.records[0]?.day ?? detail.firstDay}
              currentDay={currentDay}
              history={history}
              profitColorScheme={profitColorScheme}
              reportingExchangeRates={reportingExchangeRates}
              source={{ ...source, ...(source.kind === "manual" ? { manualRecords: records, trendHistory } : {}) }}
            />
        </WorkbenchPage>
      </WorkbenchShell>
    </SessionGuard>
  );
}
