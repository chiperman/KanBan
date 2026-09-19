import { rangeDays, type InvestmentPerformanceIntervalPreset } from "@/domain/investment-performance-trend";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";

import { shanghaiDay } from "@/domain/daily-asset-snapshots";
import { longbridgeReferenceRates } from "@/domain/investment-performance";
import {
  redirectLoopbackIpToLocalhost,
  type PageSearchParams,
} from "@/server/auth/canonical-origin";
import { getServices } from "@/server/composition";
import { AssetSourceDetail } from "@/ui/asset-source-detail";
import {
  DEFAULT_PROFIT_COLOR_SCHEME,
  isProfitColorScheme,
  PROFIT_COLOR_SCHEME_COOKIE_KEY,
} from "@/ui/profit-color-scheme";
import { SessionGuard } from "@/ui/session-guard";
import { WorkbenchShell } from "@/ui/workbench-shell";

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
  const preset: InvestmentPerformanceIntervalPreset = typeof value === "string" && ["month-to-date", "1m", "6m", "year-to-date", "1y", "all", "custom"].includes(value) ? value as InvestmentPerformanceIntervalPreset : "month-to-date";
  function validDay(value: unknown): value is string {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value && value <= currentDay;
  }
  const customRange = preset === "custom" && validDay(query?.from) && validDay(query?.to) && query.from <= query.to ? {startDay: query.from, endDay: query.to} : null;
  const effectivePreset = preset === "custom" && !customRange ? "month-to-date" : preset;
  const days = rangeDays(effectivePreset, currentDay, undefined, customRange);
  const detailQuery = { sourceId: id, ...(effectivePreset === "all" ? {} : {from: days[0], to: days.at(-1)}) };
  const [detail, cards, fullRefreshState] = await Promise.all([
    services.assetSourceDetails ? services.assetSourceDetails.readSourceDetail(detailQuery) : (async () => {
      const [sources, manualRecords, allHistory] = await Promise.all([services.assetSources.list(), services.manualAssetRecords.list(), services.dailyAssetSnapshots.listTrendObservations()]);
      return { sources, manualRecords: manualRecords.filter((record) => record.sourceId === id),
        firstDay: allHistory.filter((day) => day.sources.some((source) => source.sourceId === id)).map((day) => day.day).sort()[0],
        history: allHistory.filter((day) => (!detailQuery.from || day.day >= detailQuery.from) && (!detailQuery.to || day.day <= detailQuery.to)).map((day) => ({...day, sources: day.sources.filter((source) => source.sourceId === id)})) };
    })(),
    services.assetCards.list(),
    services.assetFullRefreshState.read(),
  ]);
  const { sources, manualRecords, history } = detail;
  const storedSource = sources.find((source) => source.id === id);
  if (!storedSource) notFound();

  const { credentialReference: _credentialReference, ...source } = storedSource;
  const records = source.kind === "manual"
    ? manualRecords.filter((record) => record.sourceId === source.id)
    : [];
  const cardHidden = cards.find((card) => card.sourceId === source.id)?.hidden ?? false;
  const reportingExchangeRates = longbridgeReferenceRates(sources);
  const savedProfitColorScheme =
    (await cookies()).get(PROFIT_COLOR_SCHEME_COOKIE_KEY)?.value ?? null;
  const profitColorScheme = isProfitColorScheme(savedProfitColorScheme)
    ? savedProfitColorScheme
    : DEFAULT_PROFIT_COLOR_SCHEME;

  return (
    <SessionGuard>
      <WorkbenchShell
        refreshEnabled={false}
        refreshRegistration={{
          attemptedAt: fullRefreshState.attemptedAt,
          sources: sources.map((item) => ({
            id: item.id,
            kind: item.kind,
            lifecycle: item.lifecycle,
            credentialAvailable: item.credentialReference !== null,
          })),
        }}
      >
        <div className="page page-workbench-destination page-asset-source-detail">
          <a className="skip-link" href="#main-content">
            跳到主要内容
          </a>
          <main id="main-content">
            <AssetSourceDetail
              initialPreset={effectivePreset}
              initialCustomRange={customRange}
              firstDay={detail.firstDay}
              cardHidden={cardHidden}
              currentDay={currentDay}
              history={history}
              profitColorScheme={profitColorScheme}
              reportingExchangeRates={reportingExchangeRates}
              source={{ ...source, ...(source.kind === "manual" ? { manualRecords: records } : {}) }}
            />
          </main>
        </div>
      </WorkbenchShell>
    </SessionGuard>
  );
}
