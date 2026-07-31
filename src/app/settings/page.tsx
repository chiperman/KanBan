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
import { ProfitColorSettings } from "@/ui/profit-color-settings";
import { RecoverySetup } from "@/ui/recovery-setup";
import { SessionGuard } from "@/ui/session-guard";
import { ThemeSwitcher } from "@/ui/theme-switcher";
import { VibeLink } from "@/ui/vibe/vibe-button";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: PageSearchParams;
}) {
  await redirectLoopbackIpToLocalhost("/settings", searchParams);

  const services = getServices();
  if ((await services.auth.currentSession()) === null) redirect("/");
  const recoveryConfigured =
    (await services.ownerRecoveryCredentials.get()) !== null;
  const savedProfitColorScheme =
    (await cookies()).get(PROFIT_COLOR_SCHEME_COOKIE_KEY)?.value ?? null;
  const initialProfitColorScheme = isProfitColorScheme(savedProfitColorScheme)
    ? savedProfitColorScheme
    : null;
  const now = services.clock.now();

  return (
    <div className="page page-settings">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <SessionGuard>
        <header className="page-header">
          <div className="header-title">
            <p className="header-label">
              <span className="header-index" aria-hidden="true">
                02
              </span>
              <span className="header-wordmark" lang="en">
                LOCAL SETTINGS
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
            <h1>本机设置</h1>
            <p>
              管理当前终端的显示偏好与备用登录方式。这些偏好只保存在当前浏览器。
            </p>
          </header>
          <section
            className="settings-section"
            aria-label="持仓盈亏显示设置"
          >
            <ProfitColorSettings initialScheme={initialProfitColorScheme} />
          </section>
          <section
            className="settings-section"
            aria-labelledby="recovery-settings-title"
          >
            <h2 id="recovery-settings-title">备用登录</h2>
            <p className="settings-description">
              配置或更新当前终端所有者的 TOTP 备用登录。
            </p>
            <RecoverySetup configured={recoveryConfigured} />
          </section>
        </main>
      </SessionGuard>
    </div>
  );
}
