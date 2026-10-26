import manifest from "../manifest.json";
import { ProductionBinanceReadOnly, ProductionBinanceSourceRefresher } from "./binance";
import { serveAssetSourcePlugin } from "../../sdk/stdio-server";
import type { AssetSourcePluginManifest } from "../../sdk/protocol";

serveAssetSourcePlugin(prices => {
  const authorization = new ProductionBinanceReadOnly(prices);
  const refresher = new ProductionBinanceSourceRefresher(prices);
  return {
    manifest: manifest as AssetSourcePluginManifest,
    read: (request, context) => refresher.refresh({ ...request, ...context }),
    authorize: async (input, observedAt) => ({
      ...await authorization.preview({ apiKey: String(input.apiKey ?? ""), apiSecret: String(input.apiSecret ?? ""), observedAt }),
      investmentBookId: "crypto",
    }),
    revalidate: async (previous, observedAt) => ({
      ...await authorization.revalidate({ credentials: previous.credentials, observedAt }), investmentBookId: "crypto",
    }),
  };
});
