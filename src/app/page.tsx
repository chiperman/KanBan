import { shanghaiDay } from "@/domain/daily-asset-snapshots";
import { getServices } from "@/server/composition";
import { CommandMenu } from "@/ui/command-menu";
import { LogoutButton } from "@/ui/logout-button";
import { OwnerDashboard } from "@/ui/owner-dashboard";
import { OwnerLogin } from "@/ui/owner-login";
import { RecoverySetup } from "@/ui/recovery-setup";
import { SessionGuard } from "@/ui/session-guard";
import { ShanghaiClock } from "@/ui/shanghai-clock";

export const dynamic = "force-dynamic";

function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export default async function AssetDashboardPage() {
  const services = getServices();
  const session = await services.auth.currentSession();
  const recoveryConfigured =
    (await services.ownerRecoveryCredentials.get()) !== null;
  const now = services.clock.now();

  if (session === null) {
    return (
      <div className="page page-locked">
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        <header className="page-header locked-header">
          <div className="locked-brand">
            <span className="header-wordmark" lang="en">
              PERSONAL ASSET DASHBOARD
            </span>
            <strong>OWNER ACCESS</strong>
            <span className="locked-view-mode" data-testid="view-mode">
              已锁定 · 仅限所有者
            </span>
          </div>
          <div className="header-side">
            <span className="header-system">LOCAL / READ ONLY</span>
            <ShanghaiClock initialTime={now.toISOString()} />
          </div>
        </header>
        <main id="main-content" className="login-main">
          <OwnerLogin recoveryConfigured={recoveryConfigured} />
        </main>
        <footer className="locked-footer">
          <span>LOCAL-FIRST · OWNER ONLY</span>
          <span>NO TRADING · NO CLOUD SYNC</span>
        </footer>
      </div>
    );
  }

  const assetCards = await services.assetCards.list();
  const assetSources = (await services.assetSources.list()).map(
    ({ credentialReference: _credentialReference, permissions: _permissions, ...source }) =>
      source,
  );
  const dailyAssetSnapshots = await services.dailyAssetSnapshots.list();

  return (
    <div className="page page-dashboard">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <SessionGuard>
        <header className="page-header">
          <div className="header-title">
            <p className="header-label">
              <span className="header-index" aria-hidden="true">
                01
              </span>
              <span className="header-wordmark" lang="en">
                PERSONAL ASSET DASHBOARD
              </span>
            </p>
            <p className="header-sub" data-testid="view-mode">
              所有者视图 · 资产看板 · 已验证身份
            </p>
          </div>
          <div className="header-side">
            <span className="header-system">LOCAL / READ ONLY</span>
            <time className="header-time" data-testid="server-time">
              {formatUtc(now)}
            </time>
            <RecoverySetup configured={recoveryConfigured} />
            <CommandMenu
              refreshEnabled={assetSources.some(
                (source) => source.lifecycle !== "disconnected",
              )}
            />
            <LogoutButton />
          </div>
        </header>
        <main id="main-content">
          <OwnerDashboard
            cards={assetCards}
            assetSources={assetSources}
            dailyAssetSnapshots={dailyAssetSnapshots}
            currentDay={shanghaiDay(now)}
          />
        </main>
      </SessionGuard>
    </div>
  );
}
