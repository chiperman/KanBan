import { cookies } from "next/headers"

import { shanghaiDay } from "@/domain/daily-asset-snapshots"
import { createDemoDashboardData } from "@/domain/demo-dashboard"
import {
  redirectLoopbackIpToLocalhost,
  type PageSearchParams,
} from "@/server/auth/canonical-origin"
import { getServices } from "@/server/composition"
import { readAssetRefreshState } from "@/server/asset-refresh-state"
import { DailyOverviewWorkspace } from "@/ui/daily-overview-workspace"
import { AssetRefreshReset } from "@/ui/asset-refresh-provider"
import { LocalClock } from "@/ui/local-clock"
import { LogoutButton } from "@/ui/logout-button"
import { OwnerLogin } from "@/ui/owner-login"
import {
  DEFAULT_PROFIT_COLOR_SCHEME,
  isProfitColorScheme,
  PROFIT_COLOR_SCHEME_COOKIE_KEY,
} from "@/ui/profit-color-scheme"
import { SessionGuard } from "@/ui/session-guard"
import { ThemeSwitcher } from "@/ui/theme-switcher"
import { WorkbenchShell } from "@/ui/workbench-shell"
import {
  WorkbenchDisplayPreferencesProvider,
} from "@/ui/workbench-display-preferences"
import { VibeLink } from "@/ui/vibe/vibe-button"

export const dynamic = "force-dynamic"

export default async function AssetDashboardPage({
  searchParams,
}: {
  searchParams: PageSearchParams
}) {
  await redirectLoopbackIpToLocalhost("/", searchParams)
  const demoMode = (await searchParams).mode === "demo"

  if (demoMode) {
    const now = new Date()
    const demo = createDemoDashboardData(now)

    return (
      <div className="page page-dashboard page-demo" data-testid="demo-mode-dashboard">
        <AssetRefreshReset />
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
              演示模式 · 虚构数据 · 无需登录
            </span>
          </div>
          <div className="header-side">
            <div className="page-header__context">
              <span className="header-system demo-mode-indicator">
                DEMO DATA / NO PERSISTENCE
              </span>
              <LocalClock initialTime={now.toISOString()} compact />
            </div>
            <div className="page-header__actions" aria-label="页面操作">
              <VibeLink
                aria-label="退出演示模式"
                className="header-demo-link"
                href="/"
                variant="outline"
              >
                退出演示
              </VibeLink>
              <ThemeSwitcher persist={false} showLabel />
            </div>
          </div>
        </header>
        <main id="main-content">
          <WorkbenchDisplayPreferencesProvider persist={false}>
            <DailyOverviewWorkspace
              cashflows={[]}
              currentDay={demo.currentDay}
              currentObservedAt={now.toISOString()}
              demoMode
              profitColorScheme={DEFAULT_PROFIT_COLOR_SCHEME}
              sources={demo.assetSources}
              trendObservations={demo.dailyAssetTrendObservations}
            />
          </WorkbenchDisplayPreferencesProvider>
        </main>
      </div>
    )
  }

  const services = getServices()
  const session = await services.auth.currentSession()
  const ownerProvisioned = (await services.ownerCredentials.get()) !== null
  const recoveryConfigured = (await services.ownerRecoveryCredentials.get()) !== null

  if (session === null) {
    return (
      <div className="page page-locked">
        <AssetRefreshReset />
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
            <div className="page-header__context">
              <LocalClock initialTime={new Date().toISOString()} compact />
            </div>
            <div className="page-header__actions" aria-label="页面操作">
              <VibeLink
                aria-label="进入演示模式"
                className="header-demo-link"
                href="/?mode=demo"
                variant="outline"
              >
                演示模式
              </VibeLink>
              <ThemeSwitcher showLabel />
            </div>
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
    fullRefreshState,
  ] = await Promise.all([
    services.assetSources.list(),
    services.investmentCashflows.list(),
    services.dailyAssetSnapshots.listTrendObservations(),
    readAssetRefreshState(services),
  ])
  const assetSources = storedSources.map(
    ({ credentialReference: _credentialReference, permissions: _permissions, ...source }) => source,
  )
  const savedProfitColorScheme =
    (await cookies()).get(PROFIT_COLOR_SCHEME_COOKIE_KEY)?.value ?? null
  const profitColorScheme = isProfitColorScheme(savedProfitColorScheme)
    ? savedProfitColorScheme
    : DEFAULT_PROFIT_COLOR_SCHEME

  return (
    <SessionGuard>
      <WorkbenchShell
        refreshEnabled
        refreshRegistration={{
          ...fullRefreshState,
          sources: storedSources.map((source) => ({
            id: source.id,
            kind: source.kind,
            lifecycle: source.lifecycle,
            credentialAvailable: source.credentialReference !== null,
          })),
        }}
      >
        <div className="page page-dashboard">
          <a className="skip-link" href="#main-content">
            跳到主要内容
          </a>
          <main id="main-content">
            <DailyOverviewWorkspace
              cashflows={cashflows}
              currentObservedAt={now.toISOString()}
              currentDay={shanghaiDay(now)}
              profitColorScheme={profitColorScheme}
              sources={assetSources}
              trendObservations={dailyAssetTrendObservations}
            />
          </main>
        </div>
      </WorkbenchShell>
    </SessionGuard>
  )
}
