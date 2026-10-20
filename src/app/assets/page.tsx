import { shanghaiDay } from "@/domain/daily-asset-snapshots";
import { AssetSourceDirectory } from "@/ui/asset-source-directory";
import { WorkspaceViewNavigation } from "@/ui/workspace-view-navigation";
import { ASSET_VIEWS } from "@/ui/workbench-navigation";
import { WorkbenchPageHeader } from "@/ui/workbench-page-header";
import { VibeLink } from "@/ui/vibe/vibe-button";
import { redirect } from "next/navigation";

import {
  redirectLoopbackIpToLocalhost,
  type PageSearchParams,
} from "@/server/auth/canonical-origin";
import { getServices } from "@/server/composition";
import { readAssetRefreshState } from "@/server/asset-refresh-state";
import { AssetsHoldingsWorkspace } from "@/ui/assets-holdings-workspace";
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
  const sourceView = (await searchParams)?.view === "sources";
  const [storedSources, manualRecords, fullRefreshState, cards, history] = await Promise.all([
    services.assetSources.list(),
    services.manualAssetRecords.list(),
    readAssetRefreshState(services),
    sourceView ? services.assetCards.list() : [],
    sourceView ? services.dailyAssetSnapshots.listTrendObservations() : [],
  ]);
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
      manualRecords: source.kind === "manual"
        ? manualRecordsBySource.get(source.id) ?? []
        : [],
    }),
  );

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
            {sourceView ? <>
              <WorkbenchPageHeader title="资产" eyebrow="PORTFOLIO / SOURCES"
                actions={<VibeLink href="/asset-sources/new" variant="primary">新增来源</VibeLink>} />
              <WorkspaceViewNavigation label="资产视角" items={ASSET_VIEWS} current="/assets?view=sources" />
              <AssetSourceDirectory cards={cards} currentDay={shanghaiDay(services.clock.now())} history={history}
                sources={storedSources.map(({ credentialReference: _credential, ...source }) => source)} />
            </> : <AssetsHoldingsWorkspace sources={sources} />}
          </main>
        </div>
      </WorkbenchShell>
    </SessionGuard>
  );
}
