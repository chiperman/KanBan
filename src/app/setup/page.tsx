import { getServices } from "@/server/composition";
import {
  redirectLoopbackIpToLocalhost,
  type PageSearchParams,
} from "@/server/auth/canonical-origin";
import { SetupPasskey } from "@/ui/setup-passkey";
import { VibeLink } from "@/ui/vibe/vibe-button";

export const dynamic = "force-dynamic";

/** 所有者预置页：仅在系统尚无凭证时可用，之后永久关闭（无公开注册）。 */
export default async function SetupPage({
  searchParams,
}: {
  searchParams: PageSearchParams;
}) {
  await redirectLoopbackIpToLocalhost("/setup", searchParams);

  const services = getServices();
  if ((await services.ownerCredentials.get()) !== null) {
    return (
      <div className="page page-setup">
        <main
          className="setup-panel vibe-auth-surface"
          data-vibe-surface="auth-panel"
        >
          <p className="card-label">OWNER PROVISION / CLOSED</p>
          <h1 className="setup-title">已预置</h1>
          <p className="setup-copy">
            入口已关闭
          </p>
          <VibeLink className="provision-primary" href="/" variant="primary">
            返回所有者登录
            <span className="provision-primary-arrow" aria-hidden="true">→</span>
          </VibeLink>
        </main>
      </div>
    );
  }

  return (
    <div className="page page-setup">
      <main
        className="setup-panel vibe-auth-surface"
        data-vibe-surface="auth-panel"
      >
        <p className="card-label">OWNER PROVISION</p>
        <h1 className="setup-title">预置唯一所有者的 Passkey</h1>
        <p className="setup-copy">
          仅可预置一次
        </p>
        <SetupPasskey />
      </main>
    </div>
  );
}
