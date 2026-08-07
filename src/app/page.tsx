import { shanghaiDay } from "@/domain/daily-asset-snapshots"
import { createDemoDashboardData } from "@/domain/demo-dashboard"
import {
  redirectLoopbackIpToLocalhost,
  type PageSearchParams,
} from "@/server/auth/canonical-origin"
import { getServices } from "@/server/composition"
import { HeaderUtilities } from "@/ui/header-utilities"
import { LocalClock } from "@/ui/local-clock"
import { LogoutButton } from "@/ui/logout-button"
import { OwnerDashboard } from "@/ui/owner-dashboard"
import { OwnerLogin } from "@/ui/owner-login"
import { SessionGuard } from "@/ui/session-guard"
import { ThemeSwitcher } from "@/ui/theme-switcher"
import { WorkbenchShell } from "@/ui/workbench-shell"
import { VibeLink } from "@/ui/vibe/vibe-button"
import { VibeDotIcon } from "@/ui/vibe/vibe-dot-icon"
import { VibeTooltip } from "@/ui/vibe/vibe-tooltip"

export const dynamic = "force-dynamic"

export default async function AssetDashboardPage({
  searchParams,
}: {
  searchParams: PageSearchParams
}) {
  await redirectLoopbackIpToLocalhost("/", searchParams)
  const demoMode = (await searchParams).mode === "demo"

  if (demoMode) {
    const demo = createDemoDashboardData(new Date())
    return (
      <div className="page page-dashboard page-demo" data-testid="demo-mode-dashboard">
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
            <span className="header-system demo-mode-indicator">
              DEMO DATA / NO PERSISTENCE
            </span>
            <LocalClock initialTime={new Date().toISOString()} compact />
            <VibeLink
              aria-label="退出演示"
              className="header-demo-link"
              href="/"
              variant="outline"
            >
              退出演示
            </VibeLink>
            <ThemeSwitcher />
          </div>
        </header>
        <main id="main-content">
          <OwnerDashboard
            cards={demo.cards}
            assetSources={demo.assetSources}
            dailyAssetTrendObservations={demo.dailyAssetTrendObservations}
            formalDailySettlements={[]}
            currentDay={demo.currentDay}
            mode="demo"
          />
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
            <VibeTooltip label="进入演示模式">
              <VibeLink
                aria-label="进入演示模式"
                className="header-action-button header-demo-link"
                href="/?mode=demo"
                variant="outline"
              >
                <VibeDotIcon name="computer" size={24} />
              </VibeLink>
            </VibeTooltip>
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
  const assetCards = await services.assetCards.list()
  const [storedSources, manualRecords, formalDailySettlements] = await Promise.all([
    services.assetSources.list(),
    services.manualAssetRecords.list(),
    services.formalDailySettlements.list(),
  ])
  const recordsBySource = new Map<string, typeof manualRecords>()
  for (const record of manualRecords) {
    recordsBySource.set(record.sourceId, [
      ...(recordsBySource.get(record.sourceId) ?? []),
      record,
    ])
  }
  const assetSources = storedSources.map(
    ({ credentialReference: _credentialReference, permissions: _permissions, ...source }) => ({
      ...source,
      ...(source.kind === "manual"
        ? { manualRecords: recordsBySource.get(source.id) ?? [] }
        : {}),
    })
  )
  const dailyAssetTrendObservations =
    await services.dailyAssetSnapshots.listTrendObservations()

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
              <HeaderUtilities
                commandMenu={false}
                refreshEnabled={assetSources.some(
                  (source) =>
                    source.lifecycle !== "disconnected" &&
                    source.kind !== "manual",
                )}
              />
              <VibeTooltip label="进入演示模式">
                <VibeLink
                  aria-label="进入演示模式"
                  className="header-action-button header-demo-link"
                  href="/?mode=demo"
                  variant="outline"
                >
                  <VibeDotIcon name="computer" size={24} />
                </VibeLink>
              </VibeTooltip>
              <LogoutButton />
              <ThemeSwitcher />
            </div>
          </header>
          <main id="main-content">
            <OwnerDashboard
              cards={assetCards}
              assetSources={assetSources}
              dailyAssetTrendObservations={dailyAssetTrendObservations}
              formalDailySettlements={formalDailySettlements}
              currentDay={shanghaiDay(now)}
            />
          </main>
        </div>
      </WorkbenchShell>
    </SessionGuard>
  )
}
