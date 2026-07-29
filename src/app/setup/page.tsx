import { getServices } from "@/server/composition";
import { SetupPasskey } from "@/ui/setup-passkey";
import { VibeLink } from "@/ui/vibe/vibe-button";

export const dynamic = "force-dynamic";

/** 所有者预置页：仅在系统尚无凭证时可用，之后永久关闭（无公开注册）。 */
export default async function SetupPage() {
  const services = getServices();
  if ((await services.ownerCredentials.get()) !== null) {
    return (
      <div className="page page-setup">
        <main
          className="setup-panel vibe-auth-surface"
          data-vibe-surface="auth-panel"
        >
          <p className="card-label">OWNER PROVISION / CLOSED</p>
          <h1 className="setup-title">所有者已完成预置</h1>
          <p className="setup-copy">
            此终端的唯一所有者已经建立，预置入口已永久关闭。
            请返回所有者登录页继续使用资产看板。
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
        <p className="card-label">OWNER PROVISION / 00</p>
        <h1 className="setup-title">预置唯一所有者的 Passkey</h1>
        <p className="setup-copy">
          此操作仅可完成一次。完成后注册入口永久关闭，
          只有持有该 Passkey 的所有者可以查看敏感内容。
        </p>
        <SetupPasskey />
      </main>
    </div>
  );
}
