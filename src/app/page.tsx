import Image from "next/image"

import { shanghaiDay } from "@/domain/daily-asset-snapshots"
import { createDemoDashboardData } from "@/domain/demo-dashboard"
import {
  redirectLoopbackIpToLocalhost,
  type PageSearchParams,
} from "@/server/auth/canonical-origin"
import { getServices } from "@/server/composition"
import { readAssetRefreshState } from "@/server/refresh/asset-refresh-state"
import { DailyOverviewWorkspace } from "@/ui/daily-overview-workspace"
import { AssetRefreshReset } from "@/ui/asset-refresh-provider"
import { LocalClock } from "@/ui/local-clock"
import { OwnerLogin } from "@/ui/owner-login"
import { DEFAULT_PROFIT_COLOR_SCHEME } from "@/ui/profit-color-scheme"
import { SessionGuard } from "@/ui/session-guard"
import { ThemeSwitcher } from "@/ui/theme-switcher"
import { WorkbenchShell } from "@/ui/workbench-shell"
import { WorkbenchPage } from "@/ui/workbench-page"
import {
  WorkbenchDisplayPreferencesProvider,
} from "@/ui/workbench-display-preferences"
import { VibeLink } from "@/ui/vibe/vibe-button"
import { assetRefreshRegistration, readProfitColorScheme } from "@/server/workbench-pages"

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
              <span className="header-wordmark" lang="en">
                资产看板
              </span>
            </p>
            <span data-testid="view-mode" hidden>
              演示模式，虚构数据，无需登录
            </span>
          </div>
          <div className="header-side">
            <div className="page-header__context">
              <span className="header-system demo-mode-indicator">
                演示数据
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
          <Image alt="KanBan" className="locked-logo" height={40} src="/icon.svg" width={40} />
          <ThemeSwitcher />
        </header>
        <main id="main-content" className="login-main">
          <OwnerLogin ownerProvisioned={ownerProvisioned} recoveryConfigured={recoveryConfigured} />
        </main>
        <footer className="locked-footer">
          <LocalClock initialTime={new Date().toISOString()} compact />
        </footer>
      </div>
    )
  }

  const now = services.clock.now()
  const [
    storedSources,
    cashflows,
    dailyAssetTrendObservations,
    investmentBooks,
    manualRecords,
    importedSourceHistory,
    fullRefreshState,
  ] = await Promise.all([
    services.assetSources.list(),
    services.investmentCashflows.list(),
    services.dailyAssetSnapshots.listTrendObservations(),
    services.investmentBooks?.readInvestmentBooks() ?? null,
    services.manualAssetRecords.list(),
    services.dailyAssetSnapshots.listImportedSourceHistoryObservations(),
    readAssetRefreshState(services),
  ])
  const assetSources = storedSources.map(
    ({ credentialReference: _credentialReference, permissions: _permissions, ...source }) => source,
  )
  const profitColorScheme = await readProfitColorScheme()

  return (
    <SessionGuard>
      <WorkbenchShell
        refreshEnabled
        refreshRegistration={assetRefreshRegistration(fullRefreshState, storedSources)}
      >
        <WorkbenchPage className="page-dashboard">
          <DailyOverviewWorkspace
              investmentBooks={investmentBooks}
              manualRecords={manualRecords}
              importedHistory={importedSourceHistory}
              cashflows={cashflows}
              currentObservedAt={now.toISOString()}
              currentDay={shanghaiDay(now)}
              profitColorScheme={profitColorScheme}
              sources={assetSources}
              trendObservations={dailyAssetTrendObservations}
            />
        </WorkbenchPage>
      </WorkbenchShell>
    </SessionGuard>
  )
}
