import { redirect } from "next/navigation";

import {
  redirectLoopbackIpToLocalhost,
  type PageSearchParams,
} from "@/server/auth/canonical-origin";
import { getServices } from "@/server/composition";
import { SessionGuard } from "@/ui/session-guard";
import { WorkbenchShell } from "@/ui/workbench-shell";

export const dynamic = "force-dynamic";

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: PageSearchParams;
}) {
  await redirectLoopbackIpToLocalhost("/performance", searchParams);
  if ((await getServices().auth.currentSession()) === null) redirect("/");

  return (
    <SessionGuard>
      <WorkbenchShell refreshEnabled={false}>
        <div className="page page-workbench-destination">
          <a className="skip-link" href="#main-content">
            跳到主要内容
          </a>
          <main id="main-content">
            <p className="card-label">PORTFOLIO / PERFORMANCE</p>
            <h1>收益分析</h1>
            <div className="empty-state">
              <p className="empty-title">收益分析正在迁移</p>
              <p className="empty-hint">
                资金账本、累计净投入、组合投资盈亏与区间解释将在此集中呈现；不会引入交易或资金操作。
              </p>
            </div>
          </main>
        </div>
      </WorkbenchShell>
    </SessionGuard>
  );
}
