const COINGECKO_ORIGIN = "https://api.coingecko.com";
const VERIFY_RETRY_DELAY_MS = 300;
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

export async function verifyCoinGecko(key: string, request: typeof globalThis.fetch = globalThis.fetch): Promise<void> {
    const coinGeckoUrl = new URL("/api/v3/simple/price", COINGECKO_ORIGIN);
    coinGeckoUrl.searchParams.set("ids", "ethereum");
    coinGeckoUrl.searchParams.set("vs_currencies", "usd");
    const coinGecko = await retryTimedOutRequest(() =>
      request(coinGeckoUrl, {
        method: "GET",
        headers: { "x-cg-demo-api-key": key },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      })
    ).catch((error) => {
      throw new Error(
        `CoinGecko 验证请求失败：${error instanceof Error ? error.message : "网络错误"}`,
      );
    });
    if (!coinGecko.ok) {
      throw new Error(`CoinGecko 验证失败（HTTP ${coinGecko.status}）`);
    }
}
