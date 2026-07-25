import { getTestServices, isTestEnv } from "@/server/composition";
import { parseCards } from "@/server/production";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isTestEnv()) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const body = (await request.json()) as { cards?: unknown };
  const cards = parseCards(body.cards);
  if (cards === null) {
    return Response.json({ error: "卡片数据格式无效" }, { status: 400 });
  }

  await getTestServices().cards.replaceAll(cards);
  return Response.json({ count: cards.length });
}
