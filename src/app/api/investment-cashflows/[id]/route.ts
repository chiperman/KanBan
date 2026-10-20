import type { InvestmentCashflowUpdate } from "@/server/ports";
import { getServices } from "@/server/composition";

export const dynamic = "force-dynamic";

async function ownerServices() {
  const services = getServices();
  return (await services.auth.currentSession()) === null ? null : services;
}

function updateInput(value: unknown): InvestmentCashflowUpdate | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const body = value as Record<string, unknown>;
  const update: InvestmentCashflowUpdate = {};
  if (body.kind !== undefined) {
    if (typeof body.kind !== "string") return null;
    update.kind = body.kind as NonNullable<typeof update.kind>;
  }
  if (body.occurredAt !== undefined) {
    if (typeof body.occurredAt !== "string") return null;
    update.occurredAt = body.occurredAt;
  }
  if (body.amount !== undefined) {
    if (typeof body.amount !== "string") return null;
    update.amount = body.amount;
  }
  if (body.currency !== undefined) {
    if (typeof body.currency !== "string") return null;
    update.currency = body.currency as NonNullable<typeof update.currency>;
  }
  if (body.note !== undefined) {
    if (body.note !== null && typeof body.note !== "string") return null;
    update.note = body.note;
  }
  return Object.keys(update).length === 0 ? null : update;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const services = await ownerServices();
  if (!services) return Response.json({ error: "需要所有者身份" }, { status: 401 });
  if (services.investmentBooks) return Response.json({ error: "资金记账已统一到三本账，请到投资账本中选择账本操作" }, { status: 409 });
  const input = updateInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "资金记录格式无效" }, { status: 400 });
  const { id } = await params;
  try {
    return Response.json({
      cashflow: await services.investmentCashflows.update(id, input),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "资金记录更新失败" },
      { status: 400 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const services = await ownerServices();
  if (!services) return Response.json({ error: "需要所有者身份" }, { status: 401 });
  if (services.investmentBooks) return Response.json({ error: "资金记账已统一到三本账，请到投资账本中选择账本操作" }, { status: 409 });
  const body = (await request.json().catch(() => null)) as {
    confirmation?: unknown;
  } | null;
  if (body?.confirmation !== "DELETE_CASHFLOW") {
    return Response.json({ error: "必须明确确认删除资金记录" }, { status: 400 });
  }
  const { id } = await params;
  try {
    await services.investmentCashflows.delete(id);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "资金记录删除失败" },
      { status: 400 },
    );
  }
}
