import { testGuard } from "@/server/testing/route-support";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = testGuard();
  if (denied) return denied;
  const url = new URL(request.url);
  const callback = new URL(
    "/api/asset-sources/longbridge/oauth/callback",
    request.url,
  );
  callback.searchParams.set("code", "fake-authorization-code");
  callback.searchParams.set("state", url.searchParams.get("state") ?? "");
  return Response.redirect(callback);
}
