import { getServices } from "@/server/composition";
import { updateCard } from "@/server/cards";

export const dynamic = "force-dynamic";

async function ownerServices() {
  const services = getServices();
  return (await services.auth.currentSession()) === null ? null : services;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const services = await ownerServices();
  if (services === null) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }

  const { id } = await params;
  const cards = await services.cards.list();
  const index = cards.findIndex((card) => card.id === id);
  if (index === -1) {
    return Response.json({ error: "卡片不存在" }, { status: 404 });
  }

  try {
    cards[index] = updateCard(cards[index], await request.json());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "卡片数据格式无效" },
      { status: 400 },
    );
  }
  await services.cards.replaceAll(cards);
  return Response.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const services = await ownerServices();
  if (services === null) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }

  const { id } = await params;
  const cards = await services.cards.list();
  const card = cards.find((item) => item.id === id);
  if (card === undefined) {
    return Response.json({ error: "卡片不存在" }, { status: 404 });
  }
  if (card.kind !== "markdown") {
    return Response.json({ error: "只能删除 Markdown 自定义卡片" }, { status: 400 });
  }
  await services.cards.replaceAll(cards.filter((item) => item.id !== id));
  return Response.json({ ok: true });
}
