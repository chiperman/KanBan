import { parseConnectionInput } from "@/server/asset-sources/longbridge-connection";
import { createPreviewRoute } from "@/server/asset-source-onboarding-http";

export const dynamic = "force-dynamic";

const route = createPreviewRoute({
  provider: "longbridge",
  parse: parseConnectionInput,
  invalidInput: "授权预览无效",
  previewFailed: "长桥授权预览失败",
  previewExpired: "授权预览已失效，请重新开始",
  readable: true,
});

export const { GET, POST, DELETE } = route;
