import {
  createTotpSecret,
  matchingTotpCounter,
  protectRecoverySecret,
  validateTotpSecret,
} from "@/server/auth/recovery";
import { getServices } from "@/server/composition";

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
  const secret = createTotpSecret();
  const label = encodeURIComponent("Personal Asset Dashboard:owner");
  return Response.json({
    secret,
    provisioningUri: `otpauth://totp/${label}?secret=${secret}&issuer=Personal%20Asset%20Dashboard`,
  });
}

export async function POST(request: Request) {
  const services = await ownerServices();
  if (!services) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }

  let secret: string;
  let counter: string;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    secret = validateTotpSecret(body.secret);
    const matched = matchingTotpCounter(secret, body.code, services.clock.now());
    if (matched === null) {
      throw new Error("当前 TOTP 验证码无效");
    }
    counter = matched;
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "TOTP 登录配置无效" },
      { status: 400 },
    );
  }

  await services.ownerRecoveryCredentials.save(
    protectRecoverySecret(secret, counter),
  );
  return Response.json({ ok: true });
}
