import manifest from "../manifest.json";
import { ProductionBitgetReadOnly, ProductionBitgetSourceRefresher } from "./bitget";
import { serveAssetSourcePlugin } from "../../sdk/stdio-server";
import type { AssetSourcePluginManifest } from "../../sdk/protocol";
serveAssetSourcePlugin(prices => {
 const authorization = new ProductionBitgetReadOnly(prices);
 const refresher = new ProductionBitgetSourceRefresher(prices);
 return { manifest: manifest as AssetSourcePluginManifest,
  read: (request, context) => refresher.refresh({ ...request, ...context }),
  authorize: async (input, observedAt) => ({ ...await authorization.preview({ apiKey: String(input.apiKey ?? ""), apiSecret: String(input.apiSecret ?? ""), passphrase: String(input.passphrase ?? ""), accountMode: input.accountMode as "classic" | "uta", observedAt }), investmentBookId: "crypto" }),
  revalidate: async (previous, observedAt) => ({ ...await authorization.revalidate({ credentials: previous.credentials, observedAt }), investmentBookId: "crypto" }),
 };
});
