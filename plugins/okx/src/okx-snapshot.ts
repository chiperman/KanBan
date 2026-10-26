import type { AssetSnapshot } from "@/server/ports";
import type { Prices } from "../../sdk/host-capabilities";
import { usdtUsdValuation } from "../../sdk/valuation-policy";
import { OkxClient } from "./okx-client";
import {
  validateAccountConfig,
  validateNoOptions,
} from "./okx-identity";
import { extractPositions } from "./okx-positions";
import {
  accountValuation,
  nativeUsdtUsdQuote,
  valuePositions,
} from "./okx-valuation";

export async function readFullSnapshot(input: {
  client: OkxClient;
  prices: Prices;
  observedAt: string;
}): Promise<{
  identity: ReturnType<typeof validateAccountConfig>;
  snapshot: AssetSnapshot;
}> {
  await input.client.syncTime();
  const identity = validateAccountConfig(await input.client.config());
  validateNoOptions(await input.client.options());
  const trading = await input.client.trading();
  const funding = await input.client.funding();
  const valuation = accountValuation(await input.client.assetValuation());
  const savings = await input.client.savings();
  const onchainActiveOrders = await input.client.onchainActiveOrders();
  const [instruments, tickers] = await Promise.all([
    input.client.instruments(),
    input.client.tickers(),
  ]);
  const usdtUsd = await usdtUsdValuation({
    native: nativeUsdtUsdQuote(instruments, tickers, input.observedAt),
    nativeSource: "OKX 现货 USDT-USD",
    observedAt: input.observedAt,
    prices: input.prices,
  });
  return {
    identity,
    snapshot: valuePositions({
      positions: extractPositions({
        trading,
        funding,
        savings,
        onchainActiveOrders,
      }),
      instruments,
      tickers,
      observedAt: input.observedAt,
      usdtUsdQuote: usdtUsd.quote,
      usdtUsdSource: usdtUsd.source,
      coverage: valuation.coverage,
      authoritativeTotal: {
        amount: valuation.total,
        currency: "USDT",
      },
    }),
  };
}
