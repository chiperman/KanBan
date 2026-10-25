import { createReauthorizePreviewRoute } from "@/server/asset-source-onboarding-http";

export const dynamic = "force-dynamic";

const route = createReauthorizePreviewRoute();

export const { GET, POST, DELETE } = route;
