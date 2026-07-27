import { parseAssetCards } from "@/server/asset-cards";
import { getTestServices, isTestEnv } from "@/server/composition";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isTestEnv()) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const body = (await request.json()) as { assetCards?: unknown };
  const assetCards = parseAssetCards(body.assetCards);
  if (assetCards === null) {
    return Response.json({ error: "资产卡片数据格式无效" }, { status: 400 });
  }

  await getTestServices().assetCards.replaceAll(assetCards);
  return Response.json({ count: assetCards.length });
}
