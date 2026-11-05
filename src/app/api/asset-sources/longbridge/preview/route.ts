import { createProviderPreviewRoute } from "@/server/asset-source-onboarding-http";

export const dynamic = "force-dynamic";

const route = createProviderPreviewRoute("longbridge", { readable: true });

export const { GET, POST, DELETE } = route;
