import { createPreviewRoute } from "@/server/asset-source-onboarding-http";

export const dynamic = "force-dynamic";

const route = createPreviewRoute({
  provider: "bitget",
  parse(body: unknown) {
    const value = body as {
      apiKey?: unknown;
      apiSecret?: unknown;
      passphrase?: unknown;
      accountMode?: unknown;
    } | null;
    return typeof value?.apiKey === "string" &&
      typeof value.apiSecret === "string" &&
      typeof value.passphrase === "string" &&
      (value.accountMode === "classic" || value.accountMode === "uta")
      ? {
          provider: "bitget" as const,
          apiKey: value.apiKey,
          apiSecret: value.apiSecret,
          passphrase: value.passphrase,
          accountMode: value.accountMode,
        }
      : null;
  },
  invalidInput: "Bitget API 凭证格式无效",
  previewFailed: "Bitget 凭证验证失败",
  previewExpired: "Bitget 预览已失效，请重新验证",
  readable: true,
});

export const { POST, GET, DELETE } = route;
