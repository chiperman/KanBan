import { shanghaiDay } from "@/domain/daily-asset-snapshots"
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
  const assetCards = await services.assetCards.list()
  const assetSources = (await services.assetSources.list()).map(
    ({ credentialReference: _credentialReference, permissions: _permissions, ...source }) => source
  )
  const dailyAssetSnapshots = await services.dailyAssetSnapshots.list()
  const dailyAssetTrendObservations =
    await services.dailyAssetSnapshots.listTrendObservations()

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
            <span data-testid="view-mode" hidden>
              所有者视图 · 资产看板 · 已验证身份
            </span>
          </div>
          <div className="header-side">
            <span className="header-system">EXTERNAL ACCESS / READ ONLY</span>
            <LocalClock initialTime={now.toISOString()} compact />
            <HeaderUtilities
              refreshEnabled={assetSources.some((source) => source.lifecycle !== "disconnected")}
            />
            <LogoutButton />
            <ThemeSwitcher />
          </div>
        </header>
        <main id="main-content">
          <OwnerDashboard
            cards={assetCards}
            assetSources={assetSources}
            dailyAssetSnapshots={dailyAssetSnapshots}
            dailyAssetTrendObservations={dailyAssetTrendObservations}
            currentDay={shanghaiDay(now)}
          />
        </main>
      </SessionGuard>
    </div>
  )
}
