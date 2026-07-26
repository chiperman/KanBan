import { getServices } from "@/server/composition";
import { shanghaiDay } from "@/domain/daily-asset-snapshots";
import { CardContent } from "@/ui/card-content";
import { LogoutButton } from "@/ui/logout-button";
import { OwnerDashboard } from "@/ui/owner-dashboard";
import { RestrictedCard } from "@/ui/restricted-card";
import { RecoverySetup } from "@/ui/recovery-setup";
import { SessionGuard } from "@/ui/session-guard";
import { ThemeSwitcher } from "@/ui/theme-switcher";
import { TotalOverviewPlaceholder } from "@/ui/total-asset-overview";

export const dynamic = "force-dynamic";

function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export default async function PublicHomePage() {
  const services = getServices();
  const cards = await services.cards.list();
  const session = await services.auth.currentSession();
  const assetSources = session
    ? (await services.assetSources.list()).map(
        ({ credentialReference: _credentialReference, permissions: _permissions, ...source }) => source,
      )
    : [];
  const dailyAssetSnapshots = session
    ? await services.dailyAssetSnapshots.list()
    : [];
  const now = services.clock.now();

  const content = (
    <>
      <header className="page-header">
        <div className="header-title">
          <p className="header-label">PERSONAL ASSET DASHBOARD · 公开主页</p>
          <p className="header-sub" data-testid="view-mode">
            {session ? "所有者视图 · 已验证身份" : "访客视图 · 无需登录"}
          </p>
        </div>
        <div className="header-side">
          <span className="header-time" data-testid="server-time">
            {formatUtc(now)}
          </span>
          {session ? <RecoverySetup /> : null}
          {session ? <LogoutButton /> : null}
          <ThemeSwitcher />
        </div>
      </header>
      <main>
        {session ? (
          <OwnerDashboard
            cards={cards}
            assetSources={assetSources}
            dailyAssetSnapshots={dailyAssetSnapshots}
            currentDay={shanghaiDay(now)}
          />
        ) : (
          <section className="card-grid" data-testid="card-grid">
            {cards.length === 0 ? (
              <div className="empty-state" data-testid="empty-state">
                <p className="empty-title">暂无公开内容</p>
                <p className="empty-hint">
                  所有者还没有发布任何卡片，公开主页将在内容发布后展示在这里。
                </p>
              </div>
            ) : (
              <>
              {cards.some((card) => card.kind === "asset") ? (
                <TotalOverviewPlaceholder />
              ) : null}
              {cards.map((card) =>
                // 服务端数据边界：访客永远不会收到私密卡片的真实内容，
                // 占位模型只包含宽度。
                card.access === "private" ? (
                  <RestrictedCard key={card.id} span={card.span} />
                ) : (
                  <article
                    key={card.id}
                    className={`card span-${card.span}`}
                    data-testid="card"
                  >
                    <CardContent card={card} />
                  </article>
                ),
              )}
              </>
            )}
          </section>
        )}
      </main>
    </>
  );

  return (
    <div className="page">
      {session ? <SessionGuard>{content}</SessionGuard> : content}
    </div>
  );
}
