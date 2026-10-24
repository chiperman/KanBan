import { BackgroundCollectionSettings } from "@/ui/background-collection-settings";
import { WorkspaceViewNavigation } from "@/ui/workspace-view-navigation";
import { AutomaticDailySettlementSettings } from "@/ui/automatic-daily-settlement-settings";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import {
  redirectLoopbackIpToLocalhost,
  type PageSearchParams,
} from "@/server/auth/canonical-origin";
import { getServices } from "@/server/composition";
import { readAssetRefreshState } from "@/server/asset-refresh-state";
import { shanghaiDay } from "@/domain/daily-asset-snapshots";
import { DataChecksSettings } from "@/ui/data-checks-settings";
import {
  isProfitColorScheme,
  PROFIT_COLOR_SCHEME_COOKIE_KEY,
} from "@/ui/profit-color-scheme";
import { BusinessDataBackupSettings } from "@/ui/business-data-backup-settings";
import { OwnerPasskeySettings } from "@/ui/owner-passkey-settings";
import { ProfitColorSettings } from "@/ui/profit-color-settings";
import { RecoverySetup } from "@/ui/recovery-setup";
import { ExternalServiceSettings } from "@/ui/external-service-settings";
import { SessionGuard } from "@/ui/session-guard";
import { TrendAppearanceSettings } from "@/ui/trend-appearance-settings";
import { WorkbenchShell } from "@/ui/workbench-shell";
import { WorkbenchPageHeader } from "@/ui/workbench-page-header";
import { assetSourceDisplayName } from "@/domain/asset-source-display-name";
import { VibeLink } from "@/ui/vibe/vibe-button";
import { VibeEntityLink } from "@/ui/vibe/vibe-entity-link";
import { VibeStatusTag } from "@/ui/vibe/vibe-data-instrument";

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
  const ownerCredential = await services.ownerCredentials.get();
  const ownerPasskeyConfigured = ownerCredential !== null;
  const ownerPasskeyBoundAt = ownerCredential?.createdAt ?? null;
  const recoveryConfigured =
    (await services.ownerRecoveryCredentials.get()) !== null;
  const savedProfitColorScheme =
    (await cookies()).get(PROFIT_COLOR_SCHEME_COOKIE_KEY)?.value ?? null;
  const initialProfitColorScheme = isProfitColorScheme(savedProfitColorScheme)
    ? savedProfitColorScheme
    : null;
  const externalServiceStatus = await services.externalServices.status();
  const [execution, scheduler, collection, storedSources, history, fullRefreshState] = await Promise.all([
    services.formalSettlementExecutions.latest(),
    services.formalSettlementScheduler.read(),
    view === "data" ? services.backgroundCollection?.read() ?? null : null,
    view === "data" ? services.assetSources.list() : [],
    view === "data" ? services.dailyAssetSnapshots.listTrendObservations() : [],
    view === "data" ? readAssetRefreshState(services) : undefined,
  ]);

  return (
    <SessionGuard>
      <WorkbenchShell
        refreshEnabled={view === "data"}
        refreshRegistration={fullRefreshState === undefined ? undefined : {
          ...fullRefreshState,
          sources: storedSources.map((source) => ({
            id: source.id,
            kind: source.kind,
            lifecycle: source.lifecycle,
            credentialAvailable: source.credentialReference !== null,
          })),
        }}
      >
        <div className="page page-settings">
          <a className="skip-link" href="#main-content">
            跳到主要内容
          </a>
          <main className={`settings-main settings-main--${view}`} id="main-content">
            <WorkbenchPageHeader
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
              aria-label="显示偏好"
            >
              <ProfitColorSettings initialScheme={initialProfitColorScheme} />
              <TrendAppearanceSettings />
            </section>
            </> : view === "security" ? <>
            <section
              className="settings-section security-settings"
              aria-labelledby="owner-security-title"
            >
              <h2 id="owner-security-title">登录保护</h2>
              <OwnerPasskeySettings
                boundAt={ownerPasskeyBoundAt}
                configured={ownerPasskeyConfigured}
                recoveryConfigured={recoveryConfigured}
              />
              <div className="security-settings__recovery">
                <h3 id="recovery-settings-title">TOTP 登录</h3>
                <RecoverySetup configured={recoveryConfigured} />
              </div>
            </section>
            </> : <div className="data-maintenance-panel">
              <section id="asset-sources" className="data-maintenance-section" aria-labelledby="asset-sources-title">
                <h2 id="asset-sources-title">资产来源</h2>
                <div className="settings-sources">
                  <VibeLink href="/asset-sources/new" variant="outline">新增来源</VibeLink>
                  {storedSources.length === 0 ? <p>尚未接入资产来源</p> : (
                    <ul className="settings-sources__list">
                      {storedSources.map((source) => {
                        const disconnected = source.lifecycle === "disconnected";
                        const failed = source.kind !== "manual" && source.sync.error !== null;
                        const attention = source.kind === "manual"
                          ? source.hasManualRecord === false
                          : source.sync.status === "expired";
                        const status = disconnected ? "已断开"
                          : source.kind === "manual" ? source.hasManualRecord === false ? "待记录" : "手工记录"
                          : failed ? "同步失败"
                          : attention ? "待更新" : "已连接";
                        return (
                          <li key={source.id}>
                            <VibeEntityLink href={`/asset-sources/${encodeURIComponent(source.id)}`}>{assetSourceDisplayName(source)}</VibeEntityLink>
                            <VibeStatusTag tone={disconnected ? "muted" : failed ? "error" : attention ? "warning" : "muted"}>{status}</VibeStatusTag>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </section>
              <section className="data-maintenance-section" aria-labelledby="collection-settlement-title">
                <h2 id="collection-settlement-title">自动采集与日结</h2>
                <div className="data-maintenance-section__content">
                  <BackgroundCollectionSettings status={collection} />
                  <AutomaticDailySettlementSettings execution={execution} scheduler={scheduler} backgroundActive={collection?.health === "running"} />
                </div>
              </section>
              <section className="data-maintenance-section" aria-labelledby="data-checks-title">
                <h2 id="data-checks-title">数据检查</h2>
                <DataChecksSettings
                  currentDay={shanghaiDay(services.clock.now())}
                  history={history}
                  sources={storedSources.map(({ credentialReference: _credential, ...source }) => source)}
                />
              </section>
              <ExternalServiceSettings initialStatus={externalServiceStatus} />
              <BusinessDataBackupSettings />
            </div>}
          </main>
        </div>
      </WorkbenchShell>
    </SessionGuard>
  );
}
