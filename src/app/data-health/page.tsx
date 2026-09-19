import { redirect } from "next/navigation";

import { shanghaiDay } from "@/domain/daily-asset-snapshots";
import {
  redirectLoopbackIpToLocalhost,
  type PageSearchParams,
} from "@/server/auth/canonical-origin";
import { getServices } from "@/server/composition";
import {
  DataHealthDiagnostics,
  type DataHealthSource,
} from "@/ui/data-health-diagnostics";
import { SessionGuard } from "@/ui/session-guard";
import { WorkbenchShell } from "@/ui/workbench-shell";
import { WorkbenchPageHeader } from "@/ui/workbench-page-header";

export const dynamic = "force-dynamic";

export default async function DataHealthPage({
  searchParams,
}: {
  searchParams: PageSearchParams;
}) {
  await redirectLoopbackIpToLocalhost("/data-health", searchParams);

  const services = getServices();
  if ((await services.auth.currentSession()) === null) redirect("/");
  const [storedSources, history] = await Promise.all([
    services.assetSources.list(),
    services.dailyAssetSnapshots.listTrendObservations(),
  ]);
  const sources: DataHealthSource[] = storedSources.map(
    ({ credentialReference: _credentialReference, ...source }) => source,
  );

  return (
    <SessionGuard>
      <WorkbenchShell refreshEnabled={false}>
        <div className="page page-workbench-destination page-data-health">
          <a className="skip-link" href="#main-content">
            跳到主要内容
          </a>
          <main id="main-content">
            <WorkbenchPageHeader eyebrow="WORKBENCH / 03" title="数据健康" />
            <DataHealthDiagnostics
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
