import { redirect } from "next/navigation";

import {
  redirectLoopbackIpToLocalhost,
  type PageSearchParams,
} from "@/server/auth/canonical-origin";
import { getServices } from "@/server/composition";
import { SessionGuard } from "@/ui/session-guard";
import { WorkbenchShell } from "@/ui/workbench-shell";

export const dynamic = "force-dynamic";

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: PageSearchParams;
}) {
  await redirectLoopbackIpToLocalhost("/assets", searchParams);
  if ((await getServices().auth.currentSession()) === null) redirect("/");

  return (
    <SessionGuard>
      <WorkbenchShell refreshEnabled={false}>
        <div className="page page-workbench-destination">
          <a className="skip-link" href="#main-content">
            跳到主要内容
          </a>
          <main id="main-content">
            <p className="card-label">PORTFOLIO / HOLDINGS</p>
            <h1>资产与持仓</h1>
            <div className="empty-state">
              <p className="empty-title">持仓观察正在迁移</p>
              <p className="empty-hint">
                此目的地将统一比较来源总额、持仓明细、价格观察与可获得的平台盈亏；现有来源详情仍可正常查看。
              </p>
            </div>
          </main>
        </div>
      </WorkbenchShell>
    </SessionGuard>
  );
}
