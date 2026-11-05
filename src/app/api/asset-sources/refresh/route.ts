import { rejectCrossOrigin } from "@/server/auth/request-origin";
import { getServices } from "@/server/composition";
import { readAssetRefreshState } from "@/server/refresh/asset-refresh-state";
import type { AssetRefreshIntent } from "@/server/ports";

export const dynamic = "force-dynamic";

export async function GET() {
  const services = getServices();
  if ((await services.auth.currentSession()) === null) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }
  return Response.json(await readAssetRefreshState(services), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const services = getServices();
  if ((await services.auth.currentSession()) === null) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    sourceIds?: unknown;
    intent?: unknown;
  } | null;
  const parsedIntent = parseIntent(body?.intent);
  if (parsedIntent === null) {
    return Response.json({ error: "刷新意图无效" }, { status: 400 });
  }

  const normalizedSourceIds = normalizeSourceIds(body?.sourceIds);
  if (body?.sourceIds !== undefined && normalizedSourceIds === null) {
    return Response.json({ error: "资产来源列表无效" }, { status: 400 });
  }
  if (
    normalizedSourceIds !== undefined &&
    parsedIntent.reason !== "manual-source"
  ) {
    return Response.json(
      { error: "仅单来源意图可以指定批量目标" },
      { status: 400 },
    );
  }
  if (
    Array.isArray(normalizedSourceIds) &&
    parsedIntent.reason === "manual-source" &&
    !normalizedSourceIds.includes(parsedIntent.sourceId)
  ) {
    return Response.json(
      { error: "批量来源必须包含意图目标" },
      { status: 400 },
    );
  }

  const targetIds = normalizedSourceIds ?? (
    parsedIntent.reason === "manual-source"
      ? [parsedIntent.sourceId]
      : []
  );
  const sources = await services.assetSources.list();
  const invalidTarget = targetIds.some((id) => {
    const source = sources.find((item) => item.id === id);
    return source === undefined ||
      source.lifecycle === "disconnected" ||
      source.credentialReference === null;
  });
  if (invalidTarget) {
    return Response.json(
      { error: "资产来源未连接或只读凭证不可用" },
      { status: 409 },
    );
  }

  const report = await services.assetSynchronization.request({
    intent: parsedIntent,
    ...(Array.isArray(normalizedSourceIds)
      ? { sourceIds: normalizedSourceIds }
      : {}),
  });
  return Response.json(report);
}

function parseIntent(value: unknown): AssetRefreshIntent | null {
  if (value === null || typeof value !== "object") return null;
  const intent = value as { reason?: unknown; sourceId?: unknown };
  if (intent.reason === "manual-global") return { reason: intent.reason };
  if (
    intent.reason === "manual-source" &&
    typeof intent.sourceId === "string" &&
    intent.sourceId.trim() !== ""
  ) {
    return { reason: intent.reason, sourceId: intent.sourceId.trim() };
  }
  if (
    intent.reason === "page-entry" ||
    intent.reason === "foreground" ||
    intent.reason === "interval"
  ) return { reason: intent.reason };
  return null;
}

function normalizeSourceIds(value: unknown): string[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) return null;
  const sourceIds = value.map((sourceId) =>
    typeof sourceId === "string" ? sourceId.trim() : "",
  );
  if (sourceIds.some((sourceId) => sourceId === "")) return null;
  return [...new Set(sourceIds)];
}
