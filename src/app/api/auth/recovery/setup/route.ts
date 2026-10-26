import { rejectCrossOrigin } from "@/server/auth/request-origin";
import { timingSafeEqual } from "node:crypto";
import {
  createTotpSecret,
  decryptRecoverySecret,
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
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const services = await ownerServices();
  if (!services) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }

  let secret: string;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
    secret = validateTotpSecret(body.secret);
  } catch {
    return Response.json({ error: "TOTP 密钥格式无效" }, { status: 400 });
  }

  // 仅核对此次持有的密钥，不回传已存密钥，也不消费验证码或改写凭证。
  if (body.action === "check") {
    const credential = await services.ownerRecoveryCredentials.get();
    if (credential === null) return Response.json({ ok: true, matches: false });
    const storedSecret = decryptRecoverySecret(credential);
    if (storedSecret === null) {
      return Response.json({ error: "暂时无法核对 TOTP 密钥，请稍后重试。" }, { status: 503 });
    }
    const stored = Buffer.from(storedSecret);
    const candidate = Buffer.from(secret);
    return Response.json({ ok: true, matches: stored.length === candidate.length && timingSafeEqual(stored, candidate) });
  }

  let counter: string;
  try {
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
