import { redirect } from "next/navigation";

import {
  redirectLoopbackIpToLocalhost,
  type PageSearchParams,
} from "@/server/auth/canonical-origin";
import { getServices } from "@/server/composition";
import { AssetSourceDirectory } from "@/ui/asset-source-directory";
import { SessionGuard } from "@/ui/session-guard";
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
  const [sources, cards] = await Promise.all([
    services.assetSources.list(),
    services.assetCards.list(),
  ]);

  return (
    <SessionGuard>
      <WorkbenchShell refreshEnabled={false}>
        <div className="page page-workbench-destination">
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
          <main id="main-content">
            <p className="card-label">WORKBENCH / 02</p>
            <h1>资产来源</h1>
            <AssetSourceDirectory cards={cards} sources={sources} />
          </main>
        </div>
      </WorkbenchShell>
    </SessionGuard>
  );
}
