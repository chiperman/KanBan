import { redirect } from "next/navigation";

import {
  redirectLoopbackIpToLocalhost,
  type PageSearchParams,
} from "@/server/auth/canonical-origin";
import { getServices } from "@/server/composition";
import { SessionGuard } from "@/ui/session-guard";
import { WorkbenchShell } from "@/ui/workbench-shell";

export const dynamic = "force-dynamic";

export default async function DataHealthPage({
  searchParams,
}: {
  searchParams: PageSearchParams;
}) {
  await redirectLoopbackIpToLocalhost("/data-health", searchParams);

  if ((await getServices().auth.currentSession()) === null) redirect("/");

  return (
    <SessionGuard>
      <WorkbenchShell refreshEnabled={false}>
        <div className="page page-workbench-destination">
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
          <main id="main-content">
            <p className="card-label">WORKBENCH / 03</p>
            <h1>数据健康</h1>
          </main>
        </div>
      </WorkbenchShell>
    </SessionGuard>
  );
}
