import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import type { OwnerRecoveryCredential } from "@/server/ports";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const scope = globalThis as typeof globalThis & {
  __kanbanRecoveryCredentialQueue?: Promise<void>;
};

/** TOTP 校验、计数器消费与密钥更换共用单进程队列。 */
export function withOwnerRecoveryCredentialLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const result = (scope.__kanbanRecoveryCredentialQueue ?? Promise.resolve())
    .then(operation, operation);
  scope.__kanbanRecoveryCredentialQueue = result.then(() => undefined, () => undefined);
  return result;
}

function recoveryEncryptionKey(): Buffer {
  const encoded = process.env.PAD_SECRET_ENCRYPTION_KEY;
  const key = encoded ? Buffer.from(encoded, "base64") : Buffer.alloc(0);
  if (key.length !== 32) {
    throw new Error(
      "PAD_SECRET_ENCRYPTION_KEY 必须配置为 32 字节 Base64 服务端密钥",
    );
  }
  return key;
}

export function protectRecoverySecret(
  secret: string,
  lastUsedTotpCounter: string | null = null,
): OwnerRecoveryCredential {
  const key = recoveryEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  return {
    version: 2,
    encryptedTotpSecret: encrypted.toString("base64url"),
    totpIv: iv.toString("base64url"),
    totpAuthTag: cipher.getAuthTag().toString("base64url"),
    lastUsedTotpCounter,
  };
}

export function decryptRecoverySecret(
  credential: OwnerRecoveryCredential,
): string | null {
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      recoveryEncryptionKey(),
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

export function matchingTotpCounter(
  secret: string,
  code: unknown,
  now: Date,
): string | null {
  if (typeof code !== "string" || !/^\d{6}$/u.test(code)) return null;
  const counter = BigInt(Math.floor(now.getTime() / 30_000));
  for (const offset of [-1n, 0n, 1n]) {
    const candidate = counter + offset;
    if (candidate < 0n) continue;
    const expected = Buffer.from(totpCode(secret, candidate));
    const actual = Buffer.from(code);
    if (timingSafeEqual(expected, actual)) return candidate.toString();
  }
  return null;
}

export function validateTotpSecret(value: unknown): string {
  if (typeof value !== "string") throw new Error("TOTP 密钥格式无效");
  const secret = value.trim().toUpperCase();
  decodeBase32(secret);
  return secret;
}
