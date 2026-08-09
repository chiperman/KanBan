import type {
  InvestmentCashflowInput,
} from "@/server/ports";
import { getServices } from "@/server/composition";

export const dynamic = "force-dynamic";

async function ownerServices() {
  const services = getServices();
  return (await services.auth.currentSession()) === null ? null : services;
}

function createInput(value: unknown): InvestmentCashflowInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const body = value as Record<string, unknown>;
  if (
    typeof body.kind !== "string" ||
    typeof body.occurredAt !== "string" ||
    typeof body.amount !== "string" ||
    typeof body.currency !== "string" ||
    (body.note !== undefined && body.note !== null && typeof body.note !== "string")
  ) {
    return null;
  }
  return {
    kind: body.kind as InvestmentCashflowInput["kind"],
    occurredAt: body.occurredAt,
    amount: body.amount,
    currency: body.currency as InvestmentCashflowInput["currency"],
    note: body.note === undefined ? null : body.note,
  };
}

export async function GET() {
  const services = await ownerServices();
  if (!services) return Response.json({ error: "需要所有者身份" }, { status: 401 });
  return Response.json({
    cashflows: await services.investmentCashflows.list(),
  });
}

export async function POST(request: Request) {
  const services = await ownerServices();
  if (!services) return Response.json({ error: "需要所有者身份" }, { status: 401 });
  const input = createInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "资金记录格式无效" }, { status: 400 });
  try {
    return Response.json(
      { cashflow: await services.investmentCashflows.create(input) },
      { status: 201 },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "资金记录保存失败" },
      { status: 400 },
    );
  }
}
