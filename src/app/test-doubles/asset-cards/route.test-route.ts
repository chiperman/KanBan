import { parseAssetCards } from "@/server/asset-cards";
import { getTestServices } from "@/server/testing/composition";
import { testGuard } from "@/server/testing/route-support";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = testGuard();
  if (denied) return denied;
  return Response.json({ assetCards: await getTestServices().assetCards.list() });
}

export async function POST(request: Request) {
  const denied = testGuard();
  if (denied) return denied;

  const body = (await request.json()) as { assetCards?: unknown };
  const assetCards = parseAssetCards(body.assetCards);
  if (assetCards === null) {
    return Response.json({ error: "资产卡片数据格式无效" }, { status: 400 });
  }

  await getTestServices().assetCards.replaceAll(assetCards);
  return Response.json({ count: assetCards.length });
}
