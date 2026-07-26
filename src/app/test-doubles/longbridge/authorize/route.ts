import { isTestEnv } from "@/server/composition";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  const url = new URL(request.url);
  const callback = new URL(
    "/api/asset-sources/longbridge/oauth/callback",
    request.url,
  );
  callback.searchParams.set("code", "fake-authorization-code");
  callback.searchParams.set("state", url.searchParams.get("state") ?? "");
  return Response.redirect(callback);
}
