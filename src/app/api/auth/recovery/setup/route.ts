import {
  createTotpSecret,
  normalizeRecoveryEmail,
  protectRecoverySecret,
  validateStrongPassword,
  validateTotpSecret,
  verifyTotp,
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

  let email: string;
  let password: string;
  let secret: string;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    email = normalizeRecoveryEmail(body.email);
    password = validateStrongPassword(body.password);
    secret = validateTotpSecret(body.secret);
    if (!verifyTotp(secret, body.code, services.clock.now())) {
      throw new Error("当前 TOTP 验证码无效");
    }
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "备用登录配置无效" },
      { status: 400 },
    );
  }

  await services.ownerRecoveryCredentials.save({
    email,
    ...protectRecoverySecret(password, secret),
  });
  return Response.json({ ok: true });
}
