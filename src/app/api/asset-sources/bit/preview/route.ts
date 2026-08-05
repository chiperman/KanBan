import { createPreviewRoute } from "@/server/asset-source-onboarding-http";

export const dynamic = "force-dynamic";

const route = createPreviewRoute({
  provider: "bit",
  parse(body: unknown) {
    const value = body as {
      apiKey?: unknown;
      apiSecret?: unknown;
      userId?: unknown;
    } | null;
    return typeof value?.apiKey === "string" &&
      typeof value.apiSecret === "string" &&
      typeof value.userId === "string"
      ? {
          provider: "bit" as const,
          apiKey: value.apiKey,
          apiSecret: value.apiSecret,
          userId: value.userId,
        }
      : null;
  },
  invalidInput: "BIT / Matrixport API 凭证格式无效",
  previewFailed: "BIT / Matrixport 凭证验证失败",
  previewExpired: "BIT / Matrixport 预览已失效，请重新验证",
  readable: true,
});

export const { POST, GET, DELETE } = route;
