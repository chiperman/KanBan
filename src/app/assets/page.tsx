import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import {
  redirectLoopbackIpToLocalhost,
  type PageSearchParams,
} from "@/server/auth/canonical-origin";
import { getServices } from "@/server/composition";
import { readAssetRefreshState } from "@/server/asset-refresh-state";
import { AssetsHoldingsWorkspace } from "@/ui/assets-holdings-workspace";
import {
  DEFAULT_PROFIT_COLOR_SCHEME,
  isProfitColorScheme,
  PROFIT_COLOR_SCHEME_COOKIE_KEY,
} from "@/ui/profit-color-scheme";
import { SessionGuard } from "@/ui/session-guard";
import { WorkbenchShell } from "@/ui/workbench-shell";

export const dynamic = "force-dynamic";

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: PageSearchParams;
}) {
  await redirectLoopbackIpToLocalhost("/assets", searchParams);
  const services = getServices();
  if ((await services.auth.currentSession()) === null) redirect("/");
  if ((await searchParams)?.view === "sources") {
    redirect("/settings?view=data#asset-sources");
  }
  const [storedSources, manualRecords, cards, fullRefreshState] = await Promise.all([
    services.assetSources.list(),
    services.manualAssetRecords.list(),
    services.assetCards.list(),
    readAssetRefreshState(services),
  ]);
  const hiddenSourceIds = new Set(cards.filter((card) => card.hidden).map((card) => card.sourceId));
  const manualRecordsBySource = new Map<string, typeof manualRecords>();
  for (const record of manualRecords) {
    manualRecordsBySource.set(record.sourceId, [
      ...(manualRecordsBySource.get(record.sourceId) ?? []),
      record,
    ]);
  }
  const sources = storedSources.map(
    ({ credentialReference: _credentialReference, permissions: _permissions, ...source }) => ({
      ...source,
      hidden: hiddenSourceIds.has(source.id),
      manualRecords: source.kind === "manual"
        ? manualRecordsBySource.get(source.id) ?? []
        : [],
    }),
  );
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
          sources: storedSources.map((source) => ({
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
            <AssetsHoldingsWorkspace sources={sources} profitColorScheme={profitColorScheme} />
          </main>
        </div>
      </WorkbenchShell>
    </SessionGuard>
  );
}
