import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { LongbridgeAccountIdentity } from "./longbridge-keychain-sdk";

const runFile = promisify(execFile);
type IdentityRequest = {
  signal: AbortSignal;
  resolve(account: LongbridgeAccountIdentity): void;
  reject(error: unknown): void;
};
const batches = new Map<string, IdentityRequest[]>();
let identityQueue = Promise.resolve();

async function readIdentity(command: string): Promise<LongbridgeAccountIdentity> {
  const { stdout } = await runFile(command, ["auth", "status", "--format", "json"], {
    timeout: 15_000, maxBuffer: 1_048_576,
  });
  const account = JSON.parse(stdout)?.account;
  if (!Number.isSafeInteger(account?.member_id) || account.member_id <= 0 ||
      typeof account.account_channel !== "string" || !account.account_channel.trim()) throw new Error("长桥 CLI 账户身份不可用");
  return { memberId: String(account.member_id), accountChannel: account.account_channel };
}

/** 同批检查共享读取；后续检查排队启动，保证读取后的核验不会复用读取前的结果。 */
export async function cliIdentity(signal: AbortSignal): Promise<LongbridgeAccountIdentity> {
  signal.throwIfAborted();
  const command = process.env.LONGBRIDGE_SERVE_BIN ?? "longbridge";
  let batch = batches.get(command);
  if (!batch) {
    batch = [];
    batches.set(command, batch);
    const requests = batch;
    identityQueue = identityQueue.then(async () => {
      batches.delete(command);
      if (requests.every(request => request.signal.aborted)) return;
      try {
        const account = await readIdentity(command);
        for (const request of requests) request.resolve(account);
      } catch (error) {
        for (const request of requests) request.reject(error);
      }
    });
  }
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    batch.push({ signal,
      resolve: account => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) reject(signal.reason); else resolve(account);
      },
      reject: error => { signal.removeEventListener("abort", abort); reject(error); },
    });
  });
}

export { sameAccount } from "../../sdk/longbridge-connection";
