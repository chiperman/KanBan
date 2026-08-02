import { getServices } from "@/server/composition";
import type { ExternalServiceConfigurationInput } from "@/server/ports";

export const dynamic = "force-dynamic";

async function ownerServices() {
  const services = getServices();
  return (await services.auth.currentSession()) === null ? null : services;
}

export async function GET() {
  const services = await ownerServices();
  if (!services) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }
  return Response.json(await services.externalServices.status());
}

export async function PUT(request: Request) {
  const services = await ownerServices();
  if (!services) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) return Response.json({ error: "外部服务配置无效" }, { status: 400 });
  const input: ExternalServiceConfigurationInput = {};
  const fields = [
    "coinGeckoDemoApiKey",
    "ethereumRpcUrl",
    "bscRpcUrl",
  ] as const;
  for (const field of fields) {
    const value = body[field];
    if (value !== undefined && typeof value !== "string") {
      return Response.json({ error: "外部服务配置无效" }, { status: 400 });
    }
    if (typeof value === "string") input[field] = value;
  }
  try {
    return Response.json(await services.externalServices.saveAndVerify(input));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "外部服务验证失败" },
      { status: 400 },
    );
  }
}
