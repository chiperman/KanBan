const VERIFY_RETRY_DELAY_MS = 300;
function rpcRequest(id: number) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "eth_chainId",
    params: [],
  });
}

function rpcResult(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return typeof (value as { result?: unknown }).result === "string"
    ? (value as { result: string }).result
    : null;
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError");
}

async function retryTimedOutRequest<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isTimeout(error)) throw error;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, VERIFY_RETRY_DELAY_MS);
    });
    return operation();
  }
}

export async function verifyRpc(
    url: string,
    label: string,
    expectedChainId: string,
    id: number,
    request: typeof globalThis.fetch = globalThis.fetch,
  ): Promise<void> {
    const response = await retryTimedOutRequest(() =>
      request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: rpcRequest(id),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      })
    ).catch((error) => {
      throw new Error(
        `${label} 验证请求失败：${error instanceof Error ? error.message : "网络错误"}`,
      );
    });
    if (!response.ok) throw new Error(`${label} 验证失败（HTTP ${response.status}）`);
    const actual = rpcResult(await response.json().catch(() => null));
    if (actual?.toLowerCase() !== expectedChainId) {
      throw new Error(`${label} chain ID 不匹配`);
    }
  }
