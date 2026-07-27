import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

import type { OwnerRecoveryCredential } from "@/server/ports";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function normalizeRecoveryEmail(value: unknown): string {
  if (typeof value !== "string") throw new Error("备用登录邮箱格式无效");
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new Error("备用登录邮箱格式无效");
  }
  return email;
}

export function validateStrongPassword(value: unknown): string {
  if (typeof value !== "string") throw new Error("强密码格式无效");
  if (
    value.length < 12 ||
    !/[a-z]/u.test(value) ||
    !/[A-Z]/u.test(value) ||
    !/[0-9]/u.test(value) ||
    !/[^A-Za-z0-9]/u.test(value)
  ) {
    throw new Error("强密码至少 12 位，并包含大小写字母、数字和符号");
  }
  return value;
}

function deriveRecoveryKeys(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, 64);
}

export function protectRecoverySecret(password: string, secret: string): {
  passwordSalt: string;
  passwordHash: string;
  encryptedTotpSecret: string;
  totpIv: string;
  totpAuthTag: string;
} {
  const salt = randomBytes(16);
  const derived = deriveRecoveryKeys(password, salt);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derived.subarray(32), iv);
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  return {
    passwordSalt: salt.toString("base64url"),
    passwordHash: derived.subarray(0, 32).toString("base64url"),
    encryptedTotpSecret: encrypted.toString("base64url"),
    totpIv: iv.toString("base64url"),
    totpAuthTag: cipher.getAuthTag().toString("base64url"),
  };
}

export function verifyRecoveryPassword(
  password: string,
  saltValue: string,
  hashValue: string,
): boolean {
  try {
    const expected = Buffer.from(hashValue, "base64url");
    const actual = deriveRecoveryKeys(
      password,
      Buffer.from(saltValue, "base64url"),
    ).subarray(0, 32);
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  } catch {
    return false;
  }
}

export function decryptRecoverySecret(
  password: string,
  credential: OwnerRecoveryCredential,
): string | null {
  try {
    const derived = deriveRecoveryKeys(
      password,
      Buffer.from(credential.passwordSalt, "base64url"),
    );
    const decipher = createDecipheriv(
      "aes-256-gcm",
      derived.subarray(32),
      Buffer.from(credential.totpIv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(credential.totpAuthTag, "base64url"));
    return Buffer.concat([
      decipher.update(
        Buffer.from(credential.encryptedTotpSecret, "base64url"),
      ),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

function encodeBase32(value: Uint8Array): string {
  let bits = "";
  for (const byte of value) bits += byte.toString(2).padStart(8, "0");
  let result = "";
  for (let offset = 0; offset < bits.length; offset += 5) {
    const chunk = bits.slice(offset, offset + 5).padEnd(5, "0");
    result += BASE32_ALPHABET[Number.parseInt(chunk, 2)];
  }
  return result;
}

function decodeBase32(value: string): Buffer {
  let bits = "";
  for (const character of value.replace(/=+$/u, "").toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error("TOTP 密钥格式无效");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  if (bytes.length < 16) throw new Error("TOTP 密钥格式无效");
  return Buffer.from(bytes);
}

export function createTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

function totpCode(secret: string, counter: bigint): string {
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", decodeBase32(secret))
    .update(counterBytes)
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value =
    (((digest[offset] & 0x7f) << 24) |
      (digest[offset + 1] << 16) |
      (digest[offset + 2] << 8) |
      digest[offset + 3]) %
    1_000_000;
  return value.toString().padStart(6, "0");
}

export function verifyTotp(secret: string, code: unknown, now: Date): boolean {
  if (typeof code !== "string" || !/^\d{6}$/u.test(code)) return false;
  const counter = BigInt(Math.floor(now.getTime() / 30_000));
  for (const offset of [-1n, 0n, 1n]) {
    const expected = Buffer.from(totpCode(secret, counter + offset));
    const actual = Buffer.from(code);
    if (timingSafeEqual(expected, actual)) return true;
  }
  return false;
}

export function validateTotpSecret(value: unknown): string {
  if (typeof value !== "string") throw new Error("TOTP 密钥格式无效");
  const secret = value.trim().toUpperCase();
  decodeBase32(secret);
  return secret;
}
