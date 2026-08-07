import { notFound, redirect } from "next/navigation";

import { shanghaiDay } from "@/domain/daily-asset-snapshots";
import {
  redirectLoopbackIpToLocalhost,
  type PageSearchParams,
} from "@/server/auth/canonical-origin";
import { getServices } from "@/server/composition";
import { AssetSourceDetail } from "@/ui/asset-source-detail";
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
  const [sources, cards, manualRecords, history] = await Promise.all([
    services.assetSources.list(),
    services.assetCards.list(),
    services.manualAssetRecords.list(),
    services.dailyAssetSnapshots.listTrendObservations(),
  ]);
  const storedSource = sources.find((source) => source.id === id);
  if (!storedSource) notFound();

  const { credentialReference: _credentialReference, ...source } = storedSource;
  const records = source.kind === "manual"
    ? manualRecords.filter((record) => record.sourceId === source.id)
    : [];
  const cardHidden = cards.find((card) => card.sourceId === source.id)?.hidden ?? false;

  return (
    <SessionGuard>
      <WorkbenchShell refreshEnabled={false}>
        <div className="page page-workbench-destination page-asset-source-detail">
          <a className="skip-link" href="#main-content">
            跳到主要内容
          </a>
          <main id="main-content">
            <AssetSourceDetail
              cardHidden={cardHidden}
              currentDay={shanghaiDay(services.clock.now())}
              history={history}
              source={{ ...source, ...(source.kind === "manual" ? { manualRecords: records } : {}) }}
            />
          </main>
        </div>
      </WorkbenchShell>
    </SessionGuard>
  );
}
