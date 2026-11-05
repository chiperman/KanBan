import { createConfirmRoute } from "@/server/asset-source-onboarding-http";

export const dynamic = "force-dynamic";
export const POST = createConfirmRoute((body) =>
  body.provider === "bsc" || body.provider === "ethereum"
    ? body.provider
    : null,
);
