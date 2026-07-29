import { expect, test } from "@playwright/test";

test("Binance、OKX 与 Bitget 在行情全部不可用时明确使用 USDT/USD 1:1 兜底", async ({
  request,
}) => {
  for (const provider of ["binance", "okx", "bitget"] as const) {
    const response = await request.post(
      `/test-doubles/${provider}/production-start`,
      { data: { action: "preview-usdt-usd-fallback" } },
    );

    expect(response.ok(), provider).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({
      snapshot: {
        exchangeRates: [{
          baseCurrency: "USDT",
          quoteCurrency: "USD",
          rate: "1",
          source: "USDT/USD 固定兜底（1:1）",
        }],
      },
    });
  }
});

test("来源原生 USDT/USD 行情可用时不再请求 CoinGecko", async ({ request }) => {
  const expectedSources = {
    binance: "Binance 现货 USDTUSD",
    okx: "OKX 现货 USDT-USD",
    bitget: "Bitget 现货 USDTUSD",
  } as const;

  for (const provider of ["binance", "okx", "bitget"] as const) {
    const response = await request.post(
      `/test-doubles/${provider}/production-start`,
      { data: { action: "preview-native-usdt-usd" } },
    );

    expect(response.ok(), provider).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({
      snapshot: {
        exchangeRates: [{
          baseCurrency: "USDT",
          quoteCurrency: "USD",
          rate: "0.997",
          source: expectedSources[provider],
        }],
      },
      referencePriceRequests: 0,
    });
  }
});

test("来源原生 USDT/USD 缺失时只请求一次 CoinGecko 参考价", async ({ request }) => {
  for (const provider of ["binance", "okx", "bitget"] as const) {
    const response = await request.post(
      `/test-doubles/${provider}/production-start`,
      { data: { action: "preview-valid" } },
    );

    expect(response.ok(), provider).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({
      snapshot: {
        exchangeRates: [{
          baseCurrency: "USDT",
          quoteCurrency: "USD",
          rate: "0.998",
          source: "CoinGecko Tether/USD 参考价格",
        }],
      },
      referencePriceRequests: 1,
    });
  }
});
