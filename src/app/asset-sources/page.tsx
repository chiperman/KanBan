import { redirect } from "next/navigation";

import { shanghaiDay } from "@/domain/daily-asset-snapshots";
import {
  redirectLoopbackIpToLocalhost,
  type PageSearchParams,
} from "@/server/auth/canonical-origin";
import { getServices } from "@/server/composition";
import { AssetSourceDirectory } from "@/ui/asset-source-directory";
import { SessionGuard } from "@/ui/session-guard";
import { VibeLink } from "@/ui/vibe/vibe-button";
import { WorkbenchPageHeader } from "@/ui/workbench-page-header";
import { WorkbenchShell } from "@/ui/workbench-shell";

export const dynamic = "force-dynamic";

export default async function AssetSourcesPage({
  searchParams,
}: {
  searchParams: PageSearchParams;
}) {
  await redirectLoopbackIpToLocalhost("/asset-sources", searchParams);

  const services = getServices();
  if ((await services.auth.currentSession()) === null) redirect("/");
  const [storedSources, cards, history] = await Promise.all([
    services.assetSources.list(),
    services.assetCards.list(),
    services.dailyAssetSnapshots.listTrendObservations(),
  ]);
  const sources = storedSources.map(
    ({ credentialReference: _credentialReference, ...source }) => source,
  );

  return (
    <SessionGuard>
      <WorkbenchShell refreshEnabled={false}>
        <div className="page page-workbench-destination">
          <a className="skip-link" href="#main-content">
            跳到主要内容
          </a>
          <main id="main-content">
            <WorkbenchPageHeader
              actions={
                <VibeLink href="/asset-sources/new" variant="primary">
                  新增来源
                </VibeLink>
              }
              eyebrow="PORTFOLIO / SOURCES"
              title="来源管理"
            />
            <AssetSourceDirectory
              cards={cards}
              currentDay={shanghaiDay(services.clock.now())}
              history={history}
              sources={sources}
            />
          </main>
        </div>
      </WorkbenchShell>
    </SessionGuard>
  );
}
