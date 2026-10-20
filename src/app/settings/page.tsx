import { WorkspaceViewNavigation } from "@/ui/workspace-view-navigation";
import { AutomaticDailySettlementSettings } from "@/ui/automatic-daily-settlement-settings";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import {
  redirectLoopbackIpToLocalhost,
  type PageSearchParams,
} from "@/server/auth/canonical-origin";
import { getServices } from "@/server/composition";
import {
  isProfitColorScheme,
  PROFIT_COLOR_SCHEME_COOKIE_KEY,
} from "@/ui/profit-color-scheme";
import { BusinessDataBackupSettings } from "@/ui/business-data-backup-settings";
import { ProfitColorSettings } from "@/ui/profit-color-settings";
import { RecoverySetup } from "@/ui/recovery-setup";
import { ExternalServiceSettings } from "@/ui/external-service-settings";
import { SessionGuard } from "@/ui/session-guard";
import { WorkbenchShell } from "@/ui/workbench-shell";
import { WorkbenchPageHeader } from "@/ui/workbench-page-header";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: PageSearchParams;
}) {
  await redirectLoopbackIpToLocalhost("/settings", searchParams);

  const query = await searchParams;
  const view = query?.view === "security" ? "security" : query?.view === "data" ? "data" : "preferences";
  const services = getServices();
  if ((await services.auth.currentSession()) === null) redirect("/");
  const ownerPasskeyConfigured = (await services.ownerCredentials.get()) !== null;
  const recoveryConfigured =
    (await services.ownerRecoveryCredentials.get()) !== null;
  const savedProfitColorScheme =
    (await cookies()).get(PROFIT_COLOR_SCHEME_COOKIE_KEY)?.value ?? null;
  const initialProfitColorScheme = isProfitColorScheme(savedProfitColorScheme)
    ? savedProfitColorScheme
    : null;
  const externalServiceStatus = await services.externalServices.status();
  const [execution, scheduler] = await Promise.all([
    services.formalSettlementExecutions.latest(),
    services.formalSettlementScheduler.read(),
  ]);

  return (
    <SessionGuard>
      <WorkbenchShell refreshEnabled={false}>
        <div className="page page-settings">
          <a className="skip-link" href="#main-content">
            跳到主要内容
          </a>
          <main className={`settings-main settings-main--${view}`} id="main-content">
            <WorkbenchPageHeader
              eyebrow="LOCAL / SETTINGS"
              title="设置"
            />
            <WorkspaceViewNavigation label="设置分类" current={view === "preferences" ? "/settings" : `/settings?view=${view}`} items={[
              { href: "/settings", label: "偏好" },
              { href: "/settings?view=security", label: "安全" },
              { href: "/settings?view=data", label: "数据与维护" },
            ]} />
            {view === "preferences" ? <>
            <section
              className="settings-section"
              aria-labelledby="default-preferences-title"
            >
              <h2 id="default-preferences-title">默认偏好</h2>
              <ProfitColorSettings initialScheme={initialProfitColorScheme} />
            </section>
            </> : view === "security" ? <>
            <section
              className="settings-section security-settings"
              aria-labelledby="owner-security-title"
            >
              <h2 id="owner-security-title">登录保护</h2>
              <dl className="security-settings__statuses">
                <div>
                  <dt>Passkey</dt>
                  <dd data-vibe-tone={ownerPasskeyConfigured ? "success" : "warning"}>
                    {ownerPasskeyConfigured
                      ? "唯一所有者 Passkey 已启用"
                      : "尚未配置 Passkey"}
                  </dd>
                </div>
              </dl>
              <div className="security-settings__recovery">
                <h3 id="recovery-settings-title">TOTP 登录</h3>
                <RecoverySetup configured={recoveryConfigured} />
              </div>
            </section>
            </> : <>
              <AutomaticDailySettlementSettings execution={execution} scheduler={scheduler} />
              <BusinessDataBackupSettings />
              <ExternalServiceSettings initialStatus={externalServiceStatus} />
            </>}
          </main>
        </div>
      </WorkbenchShell>
    </SessionGuard>
  );
}
