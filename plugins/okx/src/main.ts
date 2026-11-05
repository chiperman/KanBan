import manifest from "../manifest.json";
import { ProductionOkxReadOnly, ProductionOkxSourceRefresher } from "./okx";
import { serveAssetSourcePlugin } from "../../sdk/stdio-server";
import type { AssetSourcePluginManifest } from "../../sdk/protocol";
serveAssetSourcePlugin(prices => {
 const authorization = new ProductionOkxReadOnly(prices);
 const refresher = new ProductionOkxSourceRefresher(prices);
 return { manifest: manifest as AssetSourcePluginManifest,
  read: (request, context) => refresher.refresh({ ...request, ...context }),
  authorize: async (input, observedAt) => ({ ...await authorization.preview({ apiKey: String(input.apiKey ?? ""), apiSecret: String(input.apiSecret ?? ""), passphrase: String(input.passphrase ?? ""), region: input.region as "global" | "us" | "eea", observedAt }), investmentBookId: "crypto" }),
  revalidate: async (previous, observedAt) => ({ ...await authorization.revalidate({ credentials: previous.credentials, observedAt }), investmentBookId: "crypto" }),
 };
});
