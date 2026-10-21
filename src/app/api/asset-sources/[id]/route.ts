import { getServices } from "@/server/composition";
import { rejectCrossOrigin } from "@/server/auth/request-origin";
import {
  executeAssetSourceDelete,
  executeAssetSourcePatch,
  isAssetSourceCommandInputError,
  parseAssetSourceCommandBody,
} from "@/server/asset-source-commands";

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
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const { id } = await params;
  const context = await existingSource(id);
  if ("response" in context) return context.response;
  const body = parseAssetSourceCommandBody(await request.json().catch(() => null));

  try {
    if (!await executeAssetSourcePatch({ id, ...context }, body)) {
      return Response.json({ error: "来源操作无效" }, { status: 400 });
    }
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "来源操作失败" },
      {
        status:
          isAssetSourceCommandInputError(error)
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
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const { id } = await params;
  const context = await existingSource(id);
  if ("response" in context) return context.response;
  const body = parseAssetSourceCommandBody(await request.json().catch(() => null));
  try {
    await executeAssetSourceDelete({ id, ...context }, body);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "永久删除失败" },
      { status: isAssetSourceCommandInputError(error) ? 400 : 500 },
    );
  }
  return Response.json({ ok: true });
}
