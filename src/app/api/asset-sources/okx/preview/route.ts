import { createPreviewRoute } from "@/server/asset-source-onboarding-http";

export const dynamic = "force-dynamic";

const route = createPreviewRoute({
  provider: "okx",
  parse(body: unknown) {
    const value = body as {
      apiKey?: unknown;
      apiSecret?: unknown;
      passphrase?: unknown;
      region?: unknown;
    } | null;
    return typeof value?.apiKey === "string" &&
      typeof value.apiSecret === "string" &&
      typeof value.passphrase === "string" &&
      (value.region === "global" ||
        value.region === "us" ||
        value.region === "eea")
      ? {
          provider: "okx" as const,
          apiKey: value.apiKey,
          apiSecret: value.apiSecret,
          passphrase: value.passphrase,
          region: value.region,
        }
      : null;
  },
  invalidInput: "OKX API 凭证格式无效",
  previewFailed: "OKX 凭证验证失败",
  previewExpired: "OKX 预览已失效，请重新验证",
  readable: true,
});

export const { POST, GET, DELETE } = route;
