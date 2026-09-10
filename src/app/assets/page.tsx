import { redirect } from "next/navigation";

import {
  redirectLoopbackIpToLocalhost,
  type PageSearchParams,
} from "@/server/auth/canonical-origin";
import { getServices } from "@/server/composition";
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
  const [storedSources, manualRecords, fullRefreshState] = await Promise.all([
    services.assetSources.list(),
    services.manualAssetRecords.list(),
    services.assetFullRefreshState.read(),
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
          attemptedAt: fullRefreshState.attemptedAt,
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
            <AssetsHoldingsWorkspace sources={sources} />
          </main>
        </div>
      </WorkbenchShell>
    </SessionGuard>
  );
}
