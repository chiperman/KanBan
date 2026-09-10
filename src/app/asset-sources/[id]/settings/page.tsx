import { redirect, notFound } from "next/navigation";

import { assetSourceDisplayName } from "@/domain/asset-source-display-name";
import {
  redirectLoopbackIpToLocalhost,
  type PageSearchParams,
} from "@/server/auth/canonical-origin";
import { getServices } from "@/server/composition";
import { EvmTokenPreferenceSettings } from "@/ui/evm-token-preference-settings";
import { SessionGuard } from "@/ui/session-guard";
import { VibeLink } from "@/ui/vibe/vibe-button";
import { WorkbenchPageHeader } from "@/ui/workbench-page-header";
import { WorkbenchShell } from "@/ui/workbench-shell";

export const dynamic = "force-dynamic";

export default async function AssetSourceSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: PageSearchParams;
}) {
  const { id } = await params;
  await redirectLoopbackIpToLocalhost(
    `/asset-sources/${encodeURIComponent(id)}/settings`,
    searchParams,
  );

  const services = getServices();
  if ((await services.auth.currentSession()) === null) redirect("/");
  const source = (await services.assetSources.list()).find(
    (item) => item.id === id,
  );
  if (!source || !source.kind.startsWith("evm-watch-")) notFound();

  const name = assetSourceDisplayName(source);

  return (
    <SessionGuard>
      <WorkbenchShell refreshEnabled={false}>
        <div className="page page-workbench-destination">
          <a className="skip-link" href="#main-content">
            跳到主要内容
          </a>
          <main id="main-content">
            <WorkbenchPageHeader
              actions={(
                <VibeLink
                  href={`/asset-sources/${encodeURIComponent(source.id)}`}
                  variant="outline"
                >
                  返回来源详情
                </VibeLink>
              )}
              eyebrow="WALLET / ASSET SCOPE"
              title="管理资产范围"
            />
            <EvmTokenPreferenceSettings
              sources={[{
                id: source.id,
                kind: source.kind,
                name,
                snapshot: source.snapshot,
                ignoredAssetKeys: source.ignoredAssetKeys,
                includedAssetKeys: source.includedAssetKeys,
              }]}
            />
          </main>
        </div>
      </WorkbenchShell>
    </SessionGuard>
  );
}
