import { getServices } from "@/server/composition";
import type { AssetRefreshMode } from "@/server/ports";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const services = getServices();
  if ((await services.auth.currentSession()) === null) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    mode?: unknown;
  } | null;
  const mode = body?.mode;
  if (mode !== "all" && mode !== "prices" && mode !== "holdings") {
    return Response.json({ error: "刷新类型无效" }, { status: 400 });
  }
  const report = await services.assetSynchronization.refresh(
    mode as AssetRefreshMode,
  );
  return Response.json(report);
}
