import { shanghaiDay } from "@/domain/daily-asset-snapshots"
import {
  redirectLoopbackIpToLocalhost,
  type PageSearchParams,
} from "@/server/auth/canonical-origin"
import { getServices } from "@/server/composition"
import { DailyOverviewWorkspace } from "@/ui/daily-overview-workspace"
import { LocalClock } from "@/ui/local-clock"
import { LogoutButton } from "@/ui/logout-button"
import { OwnerLogin } from "@/ui/owner-login"
import { SessionGuard } from "@/ui/session-guard"
import { ThemeSwitcher } from "@/ui/theme-switcher"
import { WorkbenchShell } from "@/ui/workbench-shell"

export const dynamic = "force-dynamic"

export default async function AssetDashboardPage({
  searchParams,
}: {
  searchParams: PageSearchParams
}) {
  await redirectLoopbackIpToLocalhost("/", searchParams)

  const services = getServices()
  const session = await services.auth.currentSession()
  const ownerProvisioned = (await services.ownerCredentials.get()) !== null
  const recoveryConfigured = (await services.ownerRecoveryCredentials.get()) !== null

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
          </div>
          <div className="header-side">
            <LocalClock initialTime={new Date().toISOString()} compact />
            <ThemeSwitcher />
          </div>
        </header>
        <main id="main-content" className="login-main">
          <OwnerLogin ownerProvisioned={ownerProvisioned} recoveryConfigured={recoveryConfigured} />
        </main>
      </div>
    )
  }

  const now = services.clock.now()
  const [
    storedSources,
    cashflows,
    dailyAssetTrendObservations,
    dailyBaselines,
  ] = await Promise.all([
    services.assetSources.list(),
    services.investmentCashflows.list(),
    services.dailyAssetSnapshots.listTrendObservations(),
    services.dailyAssetSnapshots.list(),
  ])
  const assetSources = storedSources.map(
    ({ credentialReference: _credentialReference, permissions: _permissions, ...source }) => source,
  )

  return (
    <SessionGuard>
      <WorkbenchShell
        refreshEnabled={assetSources.some(
          (source) =>
            source.lifecycle !== "disconnected" && source.kind !== "manual",
        )}
      >
        <div className="page page-dashboard">
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
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
              <span data-testid="view-mode" hidden>
                所有者视图 · 资产看板 · 已验证身份
              </span>
            </div>
            <div className="header-side">
              <span className="header-system">EXTERNAL ACCESS / READ ONLY</span>
              <LocalClock initialTime={now.toISOString()} compact />
              <LogoutButton />
              <ThemeSwitcher />
            </div>
          </header>
          <main id="main-content">
            <DailyOverviewWorkspace
              cashflows={cashflows}
              currentObservedAt={now.toISOString()}
              dailyBaselines={dailyBaselines}
              currentDay={shanghaiDay(now)}
              sources={assetSources}
              trendObservations={dailyAssetTrendObservations}
            />
          </main>
        </div>
      </WorkbenchShell>
    </SessionGuard>
  )
}
