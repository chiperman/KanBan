import { redirect } from "next/navigation";
import {
  redirectLoopbackIpToLocalhost,
  type PageSearchParams,
} from "@/server/auth/canonical-origin";
import { getServices } from "@/server/composition";
import { readAssetRefreshState } from "@/server/refresh/asset-refresh-state";
import { AssetsHoldingsWorkspace } from "@/ui/assets-holdings-workspace";
import { assetRefreshRegistration, readProfitColorScheme } from "@/server/workbench-pages";
import { SessionGuard } from "@/ui/session-guard";
import { WorkbenchShell } from "@/ui/workbench-shell";
import { WorkbenchPage } from "@/ui/workbench-page";

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
  const profitColorScheme = await readProfitColorScheme();

  return (
    <SessionGuard>
      <WorkbenchShell
        refreshEnabled
        refreshRegistration={assetRefreshRegistration(fullRefreshState, storedSources)}
      >
        <WorkbenchPage className="page-workbench-destination">
          <AssetsHoldingsWorkspace sources={sources} profitColorScheme={profitColorScheme} />
        </WorkbenchPage>
      </WorkbenchShell>
    </SessionGuard>
  );
}
