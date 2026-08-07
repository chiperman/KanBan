import { notFound, redirect } from "next/navigation";

import {
  redirectLoopbackIpToLocalhost,
  type PageSearchParams,
} from "@/server/auth/canonical-origin";
import { getServices } from "@/server/composition";
import { AssetSourceFlow } from "@/ui/asset-source-flow";
import { SessionGuard } from "@/ui/session-guard";
import { WorkbenchShell } from "@/ui/workbench-shell";

function providerFor(source: {
  kind: string;
}): "longbridge" | "binance" | "okx" | "bitget" | "bit" | "ethereum" | "bsc" | null {
  switch (source.kind) {
    case "longbridge":
    case "binance":
    case "okx":
    case "bitget":
    case "bit":
      return source.kind;
    case "evm-watch-ethereum":
      return "ethereum";
    case "evm-watch-bsc":
      return "bsc";
    default:
      return null;
  }
}

export const dynamic = "force-dynamic";

export default async function ReauthorizeAssetSourcePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: PageSearchParams;
}) {
  const { id } = await params;
  await redirectLoopbackIpToLocalhost(
    `/asset-sources/${encodeURIComponent(id)}/reauthorize`,
    searchParams,
  );
  const services = getServices();
  if ((await services.auth.currentSession()) === null) redirect("/");
  const source = (await services.assetSources.list()).find((item) => item.id === id);
  const provider = source === undefined ? null : providerFor(source);
  if (source === undefined || provider === null) notFound();

  return (
    <SessionGuard>
      <WorkbenchShell refreshEnabled={false}>
        <div className="page page-workbench-destination page-asset-source-flow">
          <a className="skip-link" href="#main-content">
            跳到主要内容
          </a>
          <main id="main-content">
            <AssetSourceFlow
              reauthorization={{
                sourceId: source.id,
                sourceLabel: source.label,
                provider,
              }}
            />
          </main>
        </div>
      </WorkbenchShell>
    </SessionGuard>
  );
}
