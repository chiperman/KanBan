import manifest from "../manifest.json";
import { CoinGeckoUsdtUsdPrices } from "./reference-prices";
import { verifyCoinGecko } from "./verify";
import { serveAssetSourcePlugin, pluginExternalServices } from "../../sdk/stdio-server";
import type { AssetSourcePluginManifest } from "../../sdk/protocol";
serveAssetSourcePlugin((_prices, runtime) => {
 const prices = new CoinGeckoUsdtUsdPrices(pluginExternalServices(runtime));
 return { manifest: manifest as AssetSourcePluginManifest,
  read: async () => { throw new Error("参考行情不是资产来源"); },
  async call(method, input) {
   if (method === "quote") return prices.quote(String((input as { symbol: unknown }).symbol));
   if (method === "verify") { await verifyCoinGecko(String((input as { key: unknown }).key)); return null; }
   throw new Error("不支持的行情能力");
  },
 };
});
