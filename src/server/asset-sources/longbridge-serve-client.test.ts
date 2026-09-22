import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";

import {
  classifyLongbridgeServeError,
  LongbridgeServeClient,
  type LongbridgeServeQuote,
} from "@/server/asset-sources/longbridge-serve-client";

type Request = {
  id: string | number;
  method: string;
  params: Record<string, unknown>;
};

class FakeServeProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly requests: Request[] = [];
  killed = false;
  onRequest: (request: Request) => void = () => undefined;
  readonly stdin = new Writable({
    write: (chunk, _encoding, callback) => {
      const lines = String(chunk).split("\n").filter(Boolean);
      for (const line of lines) {
        const request = JSON.parse(line) as Request;
        this.requests.push(request);
        this.onRequest(request);
      }
      callback();
    },
  });

  kill(): boolean {
    this.killed = true;
    this.emit("exit", null, "SIGTERM");
    return true;
  }
}

function response(process: FakeServeProcess, request: Request, result: unknown): void {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n");
}

function makeClient(process: FakeServeProcess, requestTimeoutMs = 500): LongbridgeServeClient {
  return new LongbridgeServeClient({
    requestTimeoutMs,
    spawnProcess: () => process as never,
  });
}

test("长桥 serve 错误会区分登录、CLI 缺失和其他不可用状态", () => {
  const authenticationError = classifyLongbridgeServeError(
    new Error("not logged in: authentication required"),
  );
  assert.equal(authenticationError.code, "authentication-required");

  const cliError = classifyLongbridgeServeError(
    Object.assign(new Error("spawn longbridge ENOENT"), { code: "ENOENT" }),
  );
  assert.equal(cliError.code, "cli-unavailable");

  const unavailableError = classifyLongbridgeServeError(new Error("服务响应超时"));
  assert.equal(unavailableError.code, "unavailable");
});

test("JSON-RPC 响应按 id 匹配，支持乱序响应和行情通知分流", async () => {
  const process = new FakeServeProcess();
  process.onRequest = (request) => {
    if (request.method === "initialize") response(process, request, { ok: true });
  };
  const client = makeClient(process);
  const quotes: LongbridgeServeQuote[] = [];
  client.onQuote((quote) => quotes.push(quote));

  const first = client.call("quote.quote", { symbols: ["AAPL.US"] });
  const second = client.call("quote.quote", { symbols: ["MSFT.US"] });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const requests = process.requests.filter((request) => request.method === "quote.quote");
  assert.equal(requests.length, 2);
  const aaplRequest = requests.find((request) =>
    Array.isArray(request.params.symbols) && request.params.symbols[0] === "AAPL.US",
  );
  const msftRequest = requests.find((request) =>
    Array.isArray(request.params.symbols) && request.params.symbols[0] === "MSFT.US",
  );
  assert.ok(aaplRequest);
  assert.ok(msftRequest);
  process.stdout.write(JSON.stringify({
    jsonrpc: "2.0",
    method: "quote.updated",
    params: { symbol: "AAPL.US", last_done: "200" },
  }) + "\n");
  response(process, msftRequest, { symbol: "MSFT.US", last_done: "300" });
  response(process, aaplRequest, { symbol: "AAPL.US", last_done: "200" });

  assert.deepEqual(await first, { symbol: "AAPL.US", last_done: "200" });
  assert.deepEqual(await second, { symbol: "MSFT.US", last_done: "300" });
  assert.deepEqual(quotes, [{ symbol: "AAPL.US", last_done: "200" }]);
  await client.close();
});

test("订阅参数去重并清理进程退出后的 pending 请求", async () => {
  const process = new FakeServeProcess();
  process.onRequest = (request) => {
    if (request.method === "initialize") response(process, request, { ok: true });
  };
  const client = makeClient(process, 2_000);
  const pending = client.call("quote.quote", { symbols: ["AAPL.US"] });
  await new Promise<void>((resolve) => setImmediate(resolve));
  process.emit("exit", 1, null);
  await assert.rejects(pending, /进程退出/);
  await client.close();

  const secondProcess = new FakeServeProcess();
  secondProcess.onRequest = (request) => {
    if (request.method === "initialize") response(secondProcess, request, { ok: true });
  };
  const secondClient = makeClient(secondProcess);
  const subscriptionResult = secondClient.subscribe([" AAPL.US ", "AAPL.US", ""]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const subscribeRequest = secondProcess.requests.find((request) => request.method === "quote.subscribe");
  assert.deepEqual(subscribeRequest?.params, { symbols: ["AAPL.US"] });
  response(secondProcess, subscribeRequest!, []);
  assert.deepEqual(await subscriptionResult, []);
  await secondClient.close();
});

test("客户端禁止交易写接口且不会启动 serve", async () => {
  let spawned = false;
  const client = new LongbridgeServeClient({
    spawnProcess: () => {
      spawned = true;
      return new FakeServeProcess() as never;
    },
  });
  await assert.rejects(client.call("trade.submit_order"), /只读客户端禁止调用/);
  assert.equal(spawned, false);
});
