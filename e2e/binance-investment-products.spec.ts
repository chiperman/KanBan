import { expect, test } from "@playwright/test";

test("Binance 完整读取投资产品、过滤历史仓位并保持经济资产只计一次", async ({
  request,
}) => {
  const response = await request.post("/test-doubles/binance/production-start", {
    data: { action: "preview-investments" },
  });

  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.snapshot.total).toEqual({ amount: "16599.5", currency: "USDT" });
  expect(body.snapshot.holdings).toEqual(expect.arrayContaining([
    expect.objectContaining({
      sourceProduct: "dual-investment",
      providerPositionId: "dual-current",
      sourceAsset: "BTC",
      quantity: "0.01",
      positionState: "active",
    }),
    expect.objectContaining({
      sourceProduct: "discount-buy",
      providerPositionId: "discount-current",
      sourceAsset: "USDT",
      quantity: "250",
      positionState: "settling",
    }),
    expect.objectContaining({ sourceProduct: "bfusd", quantity: "300" }),
    expect.objectContaining({ sourceProduct: "rwusd", quantity: "400" }),
    expect.objectContaining({ sourceProduct: "eth-staking", sourceAsset: "ETH", quantity: "0.5" }),
    expect.objectContaining({ sourceProduct: "sol-staking", sourceAsset: "SOL", quantity: "2" }),
    expect.objectContaining({ sourceProduct: "onchain-yields-locked", sourceAsset: "BNB", quantity: "1" }),
  ]));
  expect(body.snapshot.holdings).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ providerPositionId: "dual-settled" }),
    expect.objectContaining({ providerPositionId: "discount-settled" }),
    expect.objectContaining({ sourceProduct: "soft-staking" }),
  ]));
  expect(body.snapshot.coverage).toMatchObject({
    status: "complete",
    unexplainedValue: null,
    excludedPositiveAccounts: [],
    products: expect.arrayContaining([
      { product: "dual-investment", capability: "detailed", freshness: "current", message: null },
      { product: "discount-buy", capability: "detailed", freshness: "current", message: null },
      { product: "bfusd", capability: "detailed", freshness: "current", message: null },
      { product: "rwusd", capability: "detailed", freshness: "current", message: null },
      { product: "eth-staking", capability: "detailed", freshness: "current", message: null },
      { product: "sol-staking", capability: "detailed", freshness: "current", message: null },
      { product: "onchain-yields", capability: "detailed", freshness: "current", message: null },
      { product: "soft-staking", capability: "indirect", freshness: "current", message: expect.any(String) },
      { product: "dual-investment-rfq", capability: "unsupported", freshness: "current", message: expect.any(String) },
      { product: "smart-arbitrage", capability: "indirect", freshness: "current", message: expect.any(String) },
    ]),
  });
  expect(body.privateRequests).toEqual(expect.arrayContaining([
    "GET /sapi/v1/asset/wallet/balance",
    "GET /sapi/v1/simple-earn/account",
    "GET /sapi/v1/dci/product/accounts",
    "GET /sapi/v1/dci/product/positions?pageIndex=1&pageSize=100",
    "GET /sapi/v1/dci/product/positions?pageIndex=2&pageSize=100",
    "GET /sapi/v1/accumulator/product/sum-holding",
    "GET /sapi/v1/accumulator/product/position/list?pageIndex=1&pageSize=100",
    "GET /sapi/v1/accumulator/product/position/list?pageIndex=2&pageSize=100",
    "GET /sapi/v1/bfusd/account",
    "GET /sapi/v1/rwusd/account",
    "GET /sapi/v2/eth-staking/account",
    "GET /sapi/v1/sol-staking/account",
    "GET /sapi/v1/onchain-yields/account",
    "GET /sapi/v1/onchain-yields/locked/position?pageIndex=1&pageSize=100",
    "GET /sapi/v1/soft-staking/list",
  ]));
  expect(body.privateRequests.join("\n")).not.toMatch(/subscribe|redeem|\/set(?:\?|$)|transfer|order/i);
});

test("Binance 钱包残差、排除钱包和未知产品状态传播统计不完整", async ({
  request,
}) => {
  const gap = await request.post("/test-doubles/binance/production-start", {
    data: { action: "preview-wallet-gap" },
  });
  expect(gap.ok()).toBeTruthy();
  await expect(gap.json()).resolves.toMatchObject({
    snapshot: {
      total: { amount: "17199.5", currency: "USDT" },
      coverage: {
        status: "partial",
        unexplainedValue: { amount: "600", currency: "USDT" },
        excludedPositiveAccounts: ["Trading Bots"],
      },
    },
  });

  const unknown = await request.post("/test-doubles/binance/production-start", {
    data: { action: "preview-unknown-product-state" },
  });
  expect(unknown.ok()).toBeTruthy();
  const unknownBody = await unknown.json();
  expect(unknownBody.snapshot.coverage).toMatchObject({
    status: "partial",
    products: expect.arrayContaining([
      expect.objectContaining({
        product: "dual-investment",
        capability: "unknown",
        message: expect.stringContaining("未知状态"),
      }),
    ]),
  });
  expect(unknownBody.snapshot.holdings).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ providerPositionId: "dual-current" }),
  ]));
});

test("Binance ETH 与 SOL Staking 包装代币和账户等值只保留一个本金主源", async ({
  request,
}) => {
  const response = await request.post("/test-doubles/binance/production-start", {
    data: { action: "preview-wrapped-staking" },
  });

  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.snapshot.total).toEqual({ amount: "16599.5", currency: "USDT" });
  expect(body.snapshot.holdings).toEqual(expect.arrayContaining([
    expect.objectContaining({
      sourceProduct: "spot",
      sourceAsset: "WBETH",
      economicAssetKey: "binance:staking:ETH",
      quantity: "0.5",
    }),
    expect.objectContaining({
      sourceProduct: "spot",
      sourceAsset: "BNSOL",
      economicAssetKey: "binance:staking:SOL",
      quantity: "2",
    }),
  ]));
  expect(body.snapshot.holdings).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ sourceProduct: "eth-staking" }),
    expect.objectContaining({ sourceProduct: "sol-staking" }),
  ]));
  expect(body.snapshot.coverage).toMatchObject({
    status: "complete",
    products: expect.arrayContaining([
      expect.objectContaining({ product: "eth-staking", message: expect.stringContaining("包装代币") }),
      expect.objectContaining({ product: "sol-staking", message: expect.stringContaining("BNSOL") }),
    ]),
  });
});

test("单个投资产品读取失败时保留其他仓位并把来源标成部分覆盖", async ({
  request,
}) => {
  const response = await request.post("/test-doubles/binance/production-start", {
    data: { action: "preview-product-failure" },
  });

  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.snapshot.total).toEqual({ amount: "16599.5", currency: "USDT" });
  expect(body.snapshot.holdings).toEqual(expect.arrayContaining([
    expect.objectContaining({ sourceProduct: "dual-investment" }),
    expect.objectContaining({ sourceProduct: "rwusd" }),
  ]));
  expect(body.snapshot.holdings).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ sourceProduct: "bfusd" }),
  ]));
  expect(body.snapshot.coverage).toMatchObject({
    status: "partial",
    unexplainedValue: { amount: "300", currency: "USDT" },
    products: expect.arrayContaining([
      expect.objectContaining({
        product: "bfusd",
        capability: "unknown",
        message: expect.stringContaining("读取失败"),
      }),
    ]),
  });
});
