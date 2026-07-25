import { getServices } from "@/server/composition";
import { createOrdinaryCard } from "@/server/cards";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const services = getServices();
  if ((await services.auth.currentSession()) === null) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }

  let card;
  try {
    card = createOrdinaryCard(await request.json());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "卡片数据格式无效" },
      { status: 400 },
    );
  }

  const cards = await services.cards.list();
  if (
    card.kind !== "markdown" &&
    cards.some((existing) => existing.kind === card.kind)
  ) {
    return Response.json({ error: "该固定卡片已存在" }, { status: 409 });
  }
  await services.cards.replaceAll([...cards, card]);
  return Response.json({ id: card.id }, { status: 201 });
}
