import { notFound } from "next/navigation";

import { getServices } from "@/server/composition";
import { SetupPasskey } from "@/ui/setup-passkey";

export const dynamic = "force-dynamic";

/** 所有者预置页：仅在系统尚无凭证时可用，之后永久关闭（无公开注册）。 */
export default async function SetupPage() {
  const services = getServices();
  if ((await services.ownerCredentials.get()) !== null) {
    notFound();
  }

  return (
    <div className="page">
      <main className="setup-panel">
        <p className="card-label">所有者预置</p>
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
