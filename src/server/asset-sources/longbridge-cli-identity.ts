import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { LongbridgeAccountIdentity } from "./longbridge-keychain-sdk";

const runFile = promisify(execFile);

/** 只读取 CLI 身份，不读取 Token 文件。 */
export async function cliIdentity(signal: AbortSignal): Promise<LongbridgeAccountIdentity> {
  const { stdout } = await runFile(process.env.LONGBRIDGE_SERVE_BIN ?? "longbridge", ["auth", "status", "--format", "json"], {
    signal, timeout: 15_000, maxBuffer: 1_048_576,
  });
  const account = JSON.parse(stdout)?.account;
  if (!Number.isSafeInteger(account?.member_id) || account.member_id <= 0 ||
      typeof account.account_channel !== "string" || !account.account_channel.trim()) throw new Error("长桥 CLI 账户身份不可用");
  return { memberId: String(account.member_id), accountChannel: account.account_channel };
}

export function sameAccount(expected: LongbridgeAccountIdentity, actual: LongbridgeAccountIdentity): void {
  if (!expected.memberId || !expected.accountChannel || expected.memberId !== actual.memberId || expected.accountChannel !== actual.accountChannel) {
    throw new Error("长桥连接的账户不一致，请连接此来源的原账户");
  }
}
