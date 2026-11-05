export interface LongbridgeAccountIdentity {
  memberId: string;
  accountChannel: string;
}

export type LongbridgeConnectionMode = "cli" | "sdk" | "both";
export interface LongbridgeTransportStatus { transport: "cli" | "sdk"; fallback: boolean; at: string }
export interface LongbridgeConnection {
  version: 1;
  mode: LongbridgeConnectionMode;
  account: LongbridgeAccountIdentity;
  accountId: string;
  sdkReference?: string;
}
const prefix = "longbridge-connection:";

export function connectionReference(connection: LongbridgeConnection): string {
  const reference = prefix + Buffer.from(JSON.stringify(connection)).toString("base64url");
  if (!parseConnection(reference)) throw new Error("长桥连接配置无效");
  return reference;
}

/** 仅含账户身份和连接选择；凭证仍由 CLI / Keychain 管理。 */
export function parseConnection(reference: string | null): LongbridgeConnection | null {
  if (!reference?.startsWith(prefix)) return null;
  try {
    const value = JSON.parse(Buffer.from(reference.slice(prefix.length), "base64url").toString());
    if (value.version !== 1 || !["cli", "sdk", "both"].includes(value.mode) ||
        typeof value.accountId !== "string" || !value.accountId ||
        typeof value.account?.memberId !== "string" || !/^\d+$/.test(value.account.memberId) ||
        typeof value.account?.accountChannel !== "string" || !/^[\w-]+$/.test(value.account.accountChannel) ||
        (value.mode !== "cli" && (typeof value.sdkReference !== "string" || !value.sdkReference.startsWith("macos-keychain:")))) return null;
    return value as LongbridgeConnection;
  } catch { return null; }
}

export function isLongbridgeExternalReference(reference: string): boolean {
  return (reference.startsWith("macos-keychain:") && reference.length > 15) || parseConnection(reference) !== null;
}

export function parseConnectionInput(body: unknown) {
  const value = body as { mode?: unknown; sourceId?: unknown } | null;
  return value && (value.mode === "cli" || value.mode === "sdk" || value.mode === "both") &&
    (value.sourceId === undefined || typeof value.sourceId === "string")
    ? { provider: "longbridge" as const, connectionMode: value.mode as LongbridgeConnectionMode, sourceId: value.sourceId as string | undefined }
    : null;
}

export function sameAccount(expected: LongbridgeAccountIdentity, actual: LongbridgeAccountIdentity): void {
  if (!expected.memberId || !expected.accountChannel || expected.memberId !== actual.memberId || expected.accountChannel !== actual.accountChannel) {
    throw new Error("长桥连接的账户不一致，请连接此来源的原账户");
  }
}
