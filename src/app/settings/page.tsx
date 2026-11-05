import { createDemoPluginMarketplaceData } from "@/domain/demo-plugin-marketplace";
import { AssetRefreshReset } from "@/ui/asset-refresh-provider";
import { ThemeSwitcher } from "@/ui/theme-switcher";
import { PluginMarketplace } from "@/ui/plugin-marketplace";
import { BackgroundCollectionSettings } from "@/ui/background-collection-settings";
import { WorkspaceViewNavigation } from "@/ui/workspace-view-navigation";
import { AutomaticDailySettlementSettings } from "@/ui/automatic-daily-settlement-settings";
import { redirect } from "next/navigation";

import {
  redirectLoopbackIpToLocalhost,
  type PageSearchParams,
} from "@/server/auth/canonical-origin";
import { getServices } from "@/server/composition";
import { readAssetRefreshState } from "@/server/refresh/asset-refresh-state";
import { assetRefreshRegistration, readSavedProfitColorScheme } from "@/server/workbench-pages";
import { shanghaiDay } from "@/domain/daily-asset-snapshots";
import { DataChecksSettings } from "@/ui/data-checks-settings";
import { BusinessDataBackupSettings } from "@/ui/business-data-backup-settings";
import { OwnerPasskeySettings } from "@/ui/owner-passkey-settings";
import { ProfitColorSettings } from "@/ui/profit-color-settings";
import { ExternalServiceSettings } from "@/ui/external-service-settings";
import { SessionGuard } from "@/ui/session-guard";
import { TrendAppearanceSettings } from "@/ui/trend-appearance-settings";
import { WorkbenchShell } from "@/ui/workbench-shell";
import { WorkbenchPage } from "@/ui/workbench-page";
import { WorkbenchPageHeader } from "@/ui/workbench-page-header";
import { assetSourceDisplayName } from "@/domain/asset-source-display-name";
import { VibeLink } from "@/ui/vibe/vibe-button";
import { VibeEntityLink } from "@/ui/vibe/vibe-entity-link";
import { VibeStatusTag } from "@/ui/vibe/vibe-data-instrument";
import { sourceSummaryStatus } from "@/ui/asset-source-status";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: PageSearchParams;
}) {
  await redirectLoopbackIpToLocalhost("/settings", searchParams);

  const query = await searchParams;
  const view = query?.view === "plugins" ? "plugins" : query?.view === "security" ? "security" : query?.view === "data" ? "data" : "preferences";
  if (view === "plugins" && query.mode === "demo") {
    const demo = createDemoPluginMarketplaceData();
    return (
      <div className="page page-settings page-demo">
        <AssetRefreshReset />
        <a className="skip-link" href="#main-content">跳到主要内容</a>
        <main className="settings-main settings-main--plugins" id="main-content">
          <WorkbenchPageHeader
            title="插件"
            actions={<>
              <VibeLink href="/?mode=demo" variant="outline">返回演示总览</VibeLink>
              <VibeLink href="/" variant="outline">退出演示</VibeLink>
              <ThemeSwitcher persist={false} showLabel />
            </>}
          />
          <PluginMarketplace demoMode initialStatus={demo.status} initialCatalog={demo.catalog} />
        </main>
      </div>
    );
  }
  const services = getServices();
  if ((await services.auth.currentSession()) === null) redirect("/");
  const [ownerCredential, recoveryCredential, initialProfitColorScheme] = await Promise.all([
    view === "security" ? services.ownerCredentials.get() : null,
    view === "security" ? services.ownerRecoveryCredentials.get() : null,
    view === "preferences" ? readSavedProfitColorScheme() : null,
  ]);
  const ownerPasskeyConfigured = ownerCredential !== null;
  const ownerPasskeyBoundAt = ownerCredential?.createdAt ?? null;
  const recoveryConfigured = recoveryCredential !== null;
  const [execution, scheduler, collection, storedSources, history, fullRefreshState, externalServiceStatus] = await Promise.all([
    view === "data" ? services.formalSettlementExecutions.latest() : null,
    view === "data" ? services.formalSettlementScheduler.read() : null,
    view === "data" ? services.backgroundCollection?.read() ?? null : null,
    view === "data" ? services.assetSources.list() : [],
    view === "data" ? services.dailyAssetSnapshots.listTrendObservations() : [],
    view === "data" ? readAssetRefreshState(services) : undefined,
    view === "data" ? services.externalServices.status() : null,
  ]);

  return (
    <SessionGuard>
      <WorkbenchShell
        refreshEnabled={view === "data"}
        refreshRegistration={assetRefreshRegistration(fullRefreshState, storedSources)}
      >
        <WorkbenchPage className="page-settings" mainClassName={`settings-main settings-main--${view}`}>
            <WorkbenchPageHeader
              title="设置"
            />
            <WorkspaceViewNavigation label="设置分类" current={view === "preferences" ? "/settings" : `/settings?view=${view}`} items={[
              { href: "/settings", label: "偏好" },
              { href: "/settings?view=security", label: "安全" },
              { href: "/settings?view=data", label: "数据与维护" },
              { href: "/settings?view=plugins", label: "插件" },
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
            </section>
            </> : view === "plugins" ? (services.pluginManagement ? <PluginMarketplace initialStatus={services.pluginManagement.status()} /> : <p>当前运行环境不支持插件管理。</p>) : <div className="data-maintenance-panel">
              <section id="asset-sources" className="data-maintenance-section" aria-labelledby="asset-sources-title">
                <h2 id="asset-sources-title">资产来源</h2>
                <div className="settings-sources">
                  <VibeLink href="/asset-sources/new" variant="outline">新增来源</VibeLink>
                  {storedSources.length === 0 ? <p>尚未接入资产来源</p> : (
                    <ul className="settings-sources__list">
                      {storedSources.map((source) => {
                        const status = sourceSummaryStatus(source);
                        return (
                          <li key={source.id}>
                            <VibeEntityLink href={`/asset-sources/${encodeURIComponent(source.id)}?view=manage`}>{assetSourceDisplayName(source)}</VibeEntityLink>
                            <VibeStatusTag tone={status.tone}>{status.label}</VibeStatusTag>
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
                  {scheduler ? <AutomaticDailySettlementSettings execution={execution} scheduler={scheduler} backgroundActive={collection?.health === "running"} /> : null}
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
              {externalServiceStatus ? <ExternalServiceSettings initialStatus={externalServiceStatus} /> : null}
              <BusinessDataBackupSettings />
            </div>}
        </WorkbenchPage>
      </WorkbenchShell>
    </SessionGuard>
  );
}
