import { createPreviewRoute } from "@/server/asset-source-onboarding-http";

export const dynamic = "force-dynamic";

const route = createPreviewRoute({
  provider: "binance",
  parse(body: unknown) {
    const value = body as { apiKey?: unknown; apiSecret?: unknown } | null;
    return typeof value?.apiKey === "string" &&
      typeof value.apiSecret === "string"
      ? {
          provider: "binance" as const,
          apiKey: value.apiKey,
          apiSecret: value.apiSecret,
        }
      : null;
  },
  invalidInput: "Binance API 凭证格式无效",
  previewFailed: "Binance 凭证验证失败",
  previewExpired: "Binance 预览已失效，请重新验证",
  readable: true,
});

export const { POST, GET, DELETE } = route;
