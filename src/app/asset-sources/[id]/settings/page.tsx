import { redirect, notFound } from "next/navigation";

import { assetSourceDisplayName } from "@/domain/asset-source-display-name";
import {
  redirectLoopbackIpToLocalhost,
  type PageSearchParams,
} from "@/server/auth/canonical-origin";
import { getServices } from "@/server/composition";
import { EvmTokenPreferenceSettings } from "@/ui/evm-token-preference-settings";
import { LocalClock } from "@/ui/local-clock";
import { LogoutButton } from "@/ui/logout-button";
import { SessionGuard } from "@/ui/session-guard";
import { ThemeSwitcher } from "@/ui/theme-switcher";
import { VibeLink } from "@/ui/vibe/vibe-button";

export const dynamic = "force-dynamic";

export default async function AssetSourceSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: PageSearchParams;
}) {
  const { id } = await params;
  await redirectLoopbackIpToLocalhost(
    `/asset-sources/${encodeURIComponent(id)}/settings`,
    searchParams,
  );

  const services = getServices();
  if ((await services.auth.currentSession()) === null) redirect("/");
  const source = (await services.assetSources.list()).find(
    (item) => item.id === id,
  );
  if (!source || !source.kind.startsWith("evm-watch-")) notFound();

  const name = assetSourceDisplayName(source);
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
                03
              </span>
              <span className="header-wordmark" lang="en">
                WALLET SETTINGS
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
            <p className="card-label">WALLET / ASSET SCOPE</p>
            <h1>{name}</h1>
            <p>仅管理这个观察钱包的待确认资产和已忽略代币。</p>
          </header>
          <EvmTokenPreferenceSettings
            sources={[{
              id: source.id,
              kind: source.kind,
              name,
              snapshot: source.snapshot,
              ignoredAssetKeys: source.ignoredAssetKeys,
              includedAssetKeys: source.includedAssetKeys,
            }]}
          />
        </main>
      </SessionGuard>
    </div>
  );
}
