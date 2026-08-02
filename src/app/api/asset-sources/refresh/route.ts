import { getServices } from "@/server/composition";
import type { AssetRefreshMode, AssetRefreshScope } from "@/server/ports";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const services = getServices();
  if ((await services.auth.currentSession()) === null) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    mode?: unknown;
    scope?: unknown;
    sourceId?: unknown;
  } | null;
  const mode = body?.mode;
  const scope = body?.scope ?? "all";
  const sourceId = body?.sourceId;
  if (mode !== "all" && mode !== "prices" && mode !== "holdings") {
    return Response.json({ error: "刷新类型无效" }, { status: 400 });
  }
  if (scope !== "all" && scope !== "evm" && scope !== "non-evm") {
    return Response.json({ error: "刷新范围无效" }, { status: 400 });
  }
  if (
    sourceId !== undefined &&
    (typeof sourceId !== "string" || sourceId.trim() === "")
  ) {
    return Response.json({ error: "资产来源无效" }, { status: 400 });
  }
  if (sourceId !== undefined && scope !== "all") {
    return Response.json(
      { error: "单来源刷新不能同时指定来源范围" },
      { status: 400 },
    );
  }
  const normalizedSourceId = typeof sourceId === "string"
    ? sourceId.trim()
    : undefined;
  if (normalizedSourceId !== undefined) {
    const source = (await services.assetSources.list()).find(
      ({ id }) => id === normalizedSourceId,
    );
    if (source === undefined) {
      return Response.json({ error: "资产来源不存在" }, { status: 404 });
    }
    if (
      source.lifecycle === "disconnected" ||
      source.credentialReference === null
    ) {
      return Response.json(
        { error: "资产来源未连接或只读凭证不可用" },
        { status: 409 },
      );
    }
  }
  const report = await services.assetSynchronization.refresh(
    mode as AssetRefreshMode,
    scope as AssetRefreshScope,
    normalizedSourceId,
  );
  return Response.json(report);
}
