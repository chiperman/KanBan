/** Compatibility constructor for existing provider tests; production injects installed plugin verifiers. */
import { FileExternalServiceConfiguration as ConfigurationStore } from "./credentials/external-service-store";
import { verifyCoinGecko } from "../../plugins/coingecko/src/verify";
import { verifyRpc } from "../../plugins/evm/src/verify";
import type { SecretStore } from "./ports";
export class FileExternalServiceConfiguration extends ConfigurationStore {
 constructor(filePath: string, secrets: SecretStore, request: typeof globalThis.fetch = globalThis.fetch, now: () => Date = () => new Date()) {
  super(filePath, secrets, async input => {
   await verifyCoinGecko(input.coinGeckoDemoApiKey, request);
   await verifyRpc(input.ethereumRpcUrl, "Ethereum RPC", "0x1", 1, request);
   await verifyRpc(input.bscRpcUrl, "BSC RPC", "0x38", 2, request);
  }, now);
 }
}
