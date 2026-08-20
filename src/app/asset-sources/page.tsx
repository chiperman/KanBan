import { redirect } from "next/navigation";

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
            <WorkbenchPageHeader
              actions={
                <>
                  <VibeLink href="/data-health" variant="outline">
                    查看数据健康
                  </VibeLink>
                  <VibeLink href="/asset-sources/new" variant="primary">
                    新增来源
                  </VibeLink>
                </>
              }
              description="自动账户、观察钱包与手工资产记录统一在此查看；详情才提供单来源数据与生命周期操作。"
              eyebrow="PORTFOLIO / SOURCES"
              title="资产来源"
            />
            <AssetSourceDirectory cards={cards} sources={sources} />
          </main>
        </div>
      </WorkbenchShell>
    </SessionGuard>
  );
}
