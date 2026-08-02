import { getServices } from "@/server/composition";
import { InvalidAssetSourceDisplayNameError } from "@/domain/asset-source-display-name";
import { InvalidEvmTokenPreferenceError } from "@/domain/evm-token-preferences";

export const dynamic = "force-dynamic";

async function ownerServices() {
  const services = getServices();
  return (await services.auth.currentSession()) === null ? null : services;
}

async function existingSource(id: string) {
  const services = await ownerServices();
  if (!services) return { response: Response.json({ error: "需要所有者身份" }, { status: 401 }) };
  const source = (await services.assetSources.list()).find((item) => item.id === id);
  if (!source) return { response: Response.json({ error: "资产来源不存在" }, { status: 404 }) };
  return { services, source };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const context = await existingSource(id);
  if ("response" in context) return context.response;
  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    displayName?: unknown;
    hidden?: unknown;
    assetKeys?: unknown;
    status?: unknown;
  } | null;

  try {
    if (body?.action === "visibility" && typeof body.hidden === "boolean") {
      await context.services.assetSourceLifecycle.setHidden(id, body.hidden);
    } else if (
      body?.action === "rename" &&
      typeof body.displayName === "string"
    ) {
      await context.services.assetSourceLifecycle.setDisplayName(
        id,
        body.displayName,
      );
    } else if (
      body?.action === "evm-token-preference" &&
      Array.isArray(body.assetKeys) &&
      body.assetKeys.every((assetKey) => typeof assetKey === "string") &&
      (
        body.status === "included" ||
        body.status === "ignored" ||
        body.status === "unrecognized"
      )
    ) {
      await context.services.assetSourceLifecycle.setEvmTokenPreference(
        id,
        body.assetKeys,
        body.status,
      );
    } else if (body?.action === "disconnect") {
      await context.services.assetSourceLifecycle.disconnect(id);
    } else {
      return Response.json({ error: "来源操作无效" }, { status: 400 });
    }
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "来源操作失败" },
      {
        status:
          error instanceof InvalidAssetSourceDisplayNameError ||
            error instanceof InvalidEvmTokenPreferenceError
            ? 400
            : 500,
      },
    );
  }
  return Response.json({ ok: true });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const context = await existingSource(id);
  if ("response" in context) return context.response;
  const body = (await request.json().catch(() => null)) as {
    confirmation?: unknown;
  } | null;
  if (body?.confirmation !== "DELETE_SOURCE_DATA") {
    return Response.json({ error: "必须明确确认永久删除" }, { status: 400 });
  }
  try {
    await context.services.assetSourceLifecycle.deleteData(id);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "永久删除失败" },
      { status: 500 },
    );
  }
  return Response.json({ ok: true });
}
