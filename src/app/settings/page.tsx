import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import {
  redirectLoopbackIpToLocalhost,
  type PageSearchParams,
} from "@/server/auth/canonical-origin";
import { getServices } from "@/server/composition";
import { LocalClock } from "@/ui/local-clock";
import { LogoutButton } from "@/ui/logout-button";
import {
  isProfitColorScheme,
  PROFIT_COLOR_SCHEME_COOKIE_KEY,
} from "@/ui/profit-color-scheme";
import { BusinessDataBackupSettings } from "@/ui/business-data-backup-settings";
import { ProfitColorSettings } from "@/ui/profit-color-settings";
import { RecoverySetup } from "@/ui/recovery-setup";
import { ExternalServiceSettings } from "@/ui/external-service-settings";
import { SessionGuard } from "@/ui/session-guard";
import { ThemeSwitcher } from "@/ui/theme-switcher";
import { VibeLink } from "@/ui/vibe/vibe-button";
import { WorkbenchShell } from "@/ui/workbench-shell";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: PageSearchParams;
}) {
  await redirectLoopbackIpToLocalhost("/settings", searchParams);

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
  const now = services.clock.now();
  const externalServiceStatus = await services.externalServices.status();

  return (
    <SessionGuard>
      <WorkbenchShell refreshEnabled={false}>
        <div className="page page-settings">
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
          <header className="page-header">
            <div className="header-title">
              <p className="header-label">
                <span className="header-index" aria-hidden="true">
                  02
                </span>
                <span className="header-wordmark" lang="en">
                  SETTINGS / SECURITY
                </span>
              </p>
            </div>
            <div className="header-side">
              <LocalClock initialTime={now.toISOString()} compact />
              <VibeLink className="header-action-button" href="/" variant="outline">
                返回资产看板
              </VibeLink>
              <LogoutButton />
              <ThemeSwitcher />
            </div>
          </header>
          <main className="settings-main" id="main-content">
            <header className="settings-page-head">
              <p className="card-label">LOCAL / SETTINGS</p>
              <h1>设置与安全</h1>
              <p>
                集中管理所有者登录保护、备份恢复、本机数据和默认偏好。
              </p>
            </header>
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
                <h3 id="recovery-settings-title">备用登录</h3>
                <p className="settings-description">
                  配置或更新当前终端所有者的 TOTP 备用登录。TOTP 密钥只在本次配置中显示。
                </p>
                <RecoverySetup configured={recoveryConfigured} />
              </div>
            </section>
            <BusinessDataBackupSettings />
            <section
              className="settings-section"
              aria-labelledby="local-data-settings-title"
            >
              <h2 id="local-data-settings-title">本机数据</h2>
              <p className="settings-description">
                本机数据目录采用私有权限；目录仅限当前所有者访问，数据、备份和临时文件均以私有文件权限保存。不会在此页面显示数据路径、外部来源凭证或密钥。
              </p>
            </section>
            <section
              className="settings-section"
              aria-labelledby="default-preferences-title"
            >
              <h2 id="default-preferences-title">默认偏好</h2>
              <p className="settings-description">
                此处保存跨会话的显示偏好。计价货币和金额隐藏仍是总览的即时查看控制。
              </p>
              <ProfitColorSettings initialScheme={initialProfitColorScheme} />
            </section>
            <ExternalServiceSettings initialStatus={externalServiceStatus} />
          </main>
        </div>
      </WorkbenchShell>
    </SessionGuard>
  );
}
