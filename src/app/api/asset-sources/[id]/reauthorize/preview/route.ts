import { parseConnectionInput } from "@/server/asset-sources/longbridge-connection";
import { rejectCrossOrigin } from "@/server/auth/request-origin";
import type { AssetSourceProviderId } from "@/domain/asset-source-providers";
import { getServices } from "@/server/composition";

export const dynamic = "force-dynamic";

function providerFor(source: {
  kind: string;
}): AssetSourceProviderId | null {
  switch (source.kind) {
    case "longbridge":
    case "binance":
    case "okx":
    case "bitget":
    case "bit":
      return source.kind;
    case "evm-watch-ethereum":
      return "ethereum";
    case "evm-watch-bsc":
      return "bsc";
    default:
      return null;
  }
}

function inputFor(provider: AssetSourceProviderId, body: unknown) {
  const value = body as Record<string, unknown> | null;
  if (provider === "longbridge") return parseConnectionInput(body);
  if (provider === "binance") {
    return typeof value?.apiKey === "string" && typeof value.apiSecret === "string"
      ? { provider, apiKey: value.apiKey, apiSecret: value.apiSecret }
      : null;
  }
  if (provider === "okx") {
    return typeof value?.apiKey === "string" &&
      typeof value.apiSecret === "string" &&
      typeof value.passphrase === "string" &&
      (value.region === "global" || value.region === "us" || value.region === "eea")
      ? {
          provider,
          apiKey: value.apiKey,
          apiSecret: value.apiSecret,
          passphrase: value.passphrase,
          region: value.region,
        }
      : null;
  }
  if (provider === "bitget") {
    return typeof value?.apiKey === "string" &&
      typeof value.apiSecret === "string" &&
      typeof value.passphrase === "string" &&
      (value.accountMode === "classic" || value.accountMode === "uta")
      ? {
          provider,
          apiKey: value.apiKey,
          apiSecret: value.apiSecret,
          passphrase: value.passphrase,
          accountMode: value.accountMode,
        }
      : null;
  }
  if (provider === "bit") {
    return typeof value?.apiKey === "string" &&
      typeof value.apiSecret === "string" &&
      typeof value.userId === "string"
      ? {
          provider,
          apiKey: value.apiKey,
          apiSecret: value.apiSecret,
          userId: value.userId,
        }
      : null;
  }
  if (provider === "ethereum" || provider === "bsc") {
    return Array.isArray(value?.addresses) &&
      value.addresses.every((address) => typeof address === "string")
      ? { provider, addresses: value.addresses }
      : null;
  }
  return null;
}

async function existingSource(id: string) {
  const services = getServices();
  if ((await services.auth.currentSession()) === null) {
    return { response: Response.json({ error: "需要所有者身份" }, { status: 401 }) };
  }
  const source = (await services.assetSources.list()).find((item) => item.id === id);
  if (source === undefined) {
    return { response: Response.json({ error: "资产来源不存在" }, { status: 404 }) };
  }
  const provider = providerFor(source);
  if (provider === null) {
    return { response: Response.json({ error: "该来源不支持重新授权" }, { status: 400 }) };
  }
  return { services, source, provider };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const context = await existingSource(id);
  if ("response" in context) return context.response;
  const preview = context.services.assetSourceOnboarding.publicPreview(
    context.provider,
    new URL(request.url).searchParams.get("id") ?? "",
  );
  return preview === null
    ? Response.json({ error: "授权预览已失效，请重新验证" }, { status: 404 })
    : Response.json(preview);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const { id } = await params;
  const context = await existingSource(id);
  if ("response" in context) return context.response;
  const input = inputFor(
    context.provider,
    await request.json().catch(() => null),
  );
  if (input === null) {
    return Response.json({ error: "重新授权材料格式无效" }, { status: 400 });
  }
  try {
    return Response.json(
      await context.services.assetSourceOnboarding.preview(
        context.provider,
        context.provider === "longbridge" ? { ...input, sourceId: context.source.id } : input,
        context.services.clock.now().toISOString(),
        {
          sourceId: context.source.id,
          expectedAccountId: context.source.accountId,
        },
      ),
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "重新授权校验失败" },
      { status: 400 },
    );
  }
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
  context.services.assetSourceOnboarding.cancel(
    context.provider,
    new URL(request.url).searchParams.get("id") ?? "",
  );
  return Response.json({ ok: true });
}
