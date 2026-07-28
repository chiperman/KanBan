import { createPreviewRoute } from "@/server/asset-source-onboarding-http";

export const dynamic = "force-dynamic";

function evmRoute(provider: "ethereum" | "bsc") {
  return createPreviewRoute({
    provider,
    parse(body: unknown) {
      const value = body as { chain?: unknown; addresses?: unknown } | null;
      return value?.chain === provider &&
        Array.isArray(value.addresses) &&
        value.addresses.every((item) => typeof item === "string")
        ? { provider, addresses: value.addresses }
        : null;
    },
    invalidInput: "EVM 链或公开地址格式无效",
    previewFailed: "EVM 观察钱包预览失败",
    previewExpired: "EVM 观察钱包预览已失效，请重新验证",
  });
}

export async function POST(request: Request) {
  const body = (await request.clone().json().catch(() => null)) as {
    chain?: unknown;
  } | null;
  const provider = body?.chain === "bsc" ? "bsc" : "ethereum";
  return evmRoute(provider).POST(request);
}

export async function DELETE(request: Request) {
  const provider = new URL(request.url).searchParams.get("provider");
  return evmRoute(provider === "bsc" ? "bsc" : "ethereum").DELETE(request);
}
