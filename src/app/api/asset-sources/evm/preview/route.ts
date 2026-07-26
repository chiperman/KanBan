import { getServices } from "@/server/composition";
import type { EvmChain } from "@/server/ports";

export const dynamic = "force-dynamic";

function publicPreview(id: string) {
  const preview = getServices().evmConnections.getPublicPreview(id);
  return preview ? {
    id: preview.id,
    provider: preview.chain,
    chain: preview.chain,
    account: preview.account,
    permissions: preview.permissions,
    total: preview.snapshot.total,
  } : null;
}

export async function POST(request: Request) {
  const services = getServices();
  if ((await services.auth.currentSession()) === null) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    chain?: unknown;
    addresses?: unknown;
  } | null;
  if (
    (body?.chain !== "ethereum" && body?.chain !== "bsc") ||
    !Array.isArray(body.addresses) ||
    !body.addresses.every((item) => typeof item === "string")
  ) {
    return Response.json({ error: "EVM 链或公开地址格式无效" }, { status: 400 });
  }
  try {
    const result = await services.evm.preview({
      chain: body.chain as EvmChain,
      addresses: body.addresses,
      observedAt: services.clock.now().toISOString(),
    });
    const id = services.evmConnections.rememberPreview(result);
    return Response.json(publicPreview(id));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "EVM 观察钱包预览失败" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  const services = getServices();
  if ((await services.auth.currentSession()) === null) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }
  services.evmConnections.discardPreview(
    new URL(request.url).searchParams.get("id") ?? "",
  );
  return Response.json({ ok: true });
}
