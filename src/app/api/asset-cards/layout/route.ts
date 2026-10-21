import { rejectCrossOrigin } from "@/server/auth/request-origin";
import { updateAssetCardLayout } from "@/server/asset-cards";
import { getServices } from "@/server/composition";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const services = getServices();
  if ((await services.auth.currentSession()) === null) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }

  try {
    const cards = updateAssetCardLayout(
      await services.assetCards.list(),
      await request.json(),
    );
    await services.assetCards.replaceAll(cards);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "布局数据格式无效" },
      { status: 400 },
    );
  }

  return Response.json({ ok: true });
}
