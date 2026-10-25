import { createProviderPreviewRoute } from "@/server/asset-source-onboarding-http";
import { rejectCrossOrigin } from "@/server/auth/request-origin";

export const dynamic = "force-dynamic";

function evmRoute(provider: "ethereum" | "bsc") {
  return createProviderPreviewRoute(provider);
}

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const body = (await request.clone().json().catch(() => null)) as {
    chain?: unknown;
  } | null;
  const provider = body?.chain === "bsc" ? "bsc" : "ethereum";
  return evmRoute(provider).POST(request);
}

export async function DELETE(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const provider = new URL(request.url).searchParams.get("provider");
  return evmRoute(provider === "bsc" ? "bsc" : "ethereum").DELETE(request);
}
