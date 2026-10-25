import { createProviderPreviewRoute } from "@/server/asset-source-onboarding-http";

export const dynamic = "force-dynamic";

const route = createProviderPreviewRoute("binance", { readable: true });

export const { POST, GET, DELETE } = route;
