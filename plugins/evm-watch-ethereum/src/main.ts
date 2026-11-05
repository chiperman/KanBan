import { verifyRpc } from "../../evm/src/verify";
import manifest from "../manifest.json";
import { ProductionEvmWatchWallet, ProductionEvmWatchSourceRefresher } from "../../evm/src/ethereum";
import { serveAssetSourcePlugin, pluginExternalServices } from "../../sdk/stdio-server";
import type { AssetSourcePluginManifest } from "../../sdk/protocol";
serveAssetSourcePlugin((_prices, runtime) => {
 const services = pluginExternalServices(runtime);
 const authorization = new ProductionEvmWatchWallet(services);
 const refresher = new ProductionEvmWatchSourceRefresher(services);
 return { manifest: manifest as AssetSourcePluginManifest,
  call: async (method, raw) => {
   if (method !== "verify") throw new Error("不支持的钱包配置能力");
   await verifyRpc(String((raw as { url: unknown }).url), "Ethereum RPC", "0x1", 1); return null;
  },
  read: (request, context) => refresher.refresh({ ...request, ...context }),
  authorize: async (input, observedAt) => ({ ...await authorization.preview({ chain: "ethereum", addresses: Array.isArray(input.addresses) ? input.addresses as string[] : String(input.addresses ?? "").split(/\r?\n/).map(s => s.trim()).filter(Boolean), observedAt }), investmentBookId: "crypto" }),
  revalidate: async (previous, observedAt) => ({ ...await authorization.revalidate({ credentials: previous.credentials, observedAt }), investmentBookId: "crypto" }),
 };
});
