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
  const [sources, cards, manualRecords, history, fullRefreshState] = await Promise.all([
    services.assetSources.list(),
    services.assetCards.list(),
    services.manualAssetRecords.list(),
    services.dailyAssetSnapshots.listTrendObservations(),
    services.assetFullRefreshState.read(),
  ]);
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
              cardHidden={cardHidden}
              currentDay={shanghaiDay(services.clock.now())}
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
