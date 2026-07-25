import { getServices } from "@/server/composition";
import { LogoutButton } from "@/ui/logout-button";
import { RestrictedCard } from "@/ui/restricted-card";
import { ThemeSwitcher } from "@/ui/theme-switcher";

export const dynamic = "force-dynamic";

function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export default async function PublicHomePage() {
  const services = getServices();
  const cards = await services.cards.list();
  const session = await services.auth.currentSession();
  const now = services.clock.now();

  return (
    <div className="page">
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
          {session ? <LogoutButton /> : null}
          <ThemeSwitcher />
        </div>
      </header>
      <main>
        <section className="card-grid" data-testid="card-grid">
          {cards.length === 0 ? (
            <div className="empty-state" data-testid="empty-state">
              <p className="empty-title">暂无公开内容</p>
              <p className="empty-hint">
                所有者还没有发布任何卡片，公开主页将在内容发布后展示在这里。
              </p>
            </div>
          ) : (
            cards.map((card) =>
              // 服务端数据边界：访客永远不会收到受限卡片的真实内容，
              // 占位模型只包含 id 与宽度。
              card.access === "restricted" && !session ? (
                <RestrictedCard key={card.id} span={card.span} />
              ) : (
                <article
                  key={card.id}
                  className={`card span-${card.span}`}
                  data-testid="card"
                >
                  <p className="card-label">{card.title}</p>
                  <p className="card-body">{card.body}</p>
                </article>
              ),
            )
          )}
        </section>
      </main>
    </div>
  );
}
