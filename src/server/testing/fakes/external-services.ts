import type {
  Clock,
  EvmChain,
  ExternalServiceConfiguration,
  ExternalServiceConfigurationInput,
  ExternalServiceConfigurationStatus,
} from "@/server/ports";

export class InMemoryExternalServiceConfiguration
  implements ExternalServiceConfiguration
{
  private coinGeckoDemoApiKeyValue: string | null = null;
  private ethereumRpcUrl: string | null = null;
  private bscRpcUrl: string | null = null;
  private verifiedAt: string | null = null;

  constructor(private readonly clock: Clock) {}

  async status(): Promise<ExternalServiceConfigurationStatus> {
    return {
      coinGecko: {
        configured: this.coinGeckoDemoApiKeyValue !== null,
        verifiedAt: this.coinGeckoDemoApiKeyValue === null ? null : this.verifiedAt,
      },
      ethereumRpc: {
        configured: this.ethereumRpcUrl !== null,
        verifiedAt: this.ethereumRpcUrl === null ? null : this.verifiedAt,
      },
      bscRpc: {
        configured: this.bscRpcUrl !== null,
        verifiedAt: this.bscRpcUrl === null ? null : this.verifiedAt,
      },
    };
  }

  async saveAndVerify(
    input: ExternalServiceConfigurationInput,
  ): Promise<ExternalServiceConfigurationStatus> {
    const key = input.coinGeckoDemoApiKey?.trim() || this.coinGeckoDemoApiKeyValue;
    const ethereum = input.ethereumRpcUrl?.trim() || this.ethereumRpcUrl;
    const bsc = input.bscRpcUrl?.trim() || this.bscRpcUrl;
    if (!key || !ethereum || !bsc) {
      throw new Error("请一次配置 CoinGecko、Ethereum RPC 与 BSC RPC");
    }
    for (const [label, value] of [
      ["Ethereum RPC URL", ethereum],
      ["BSC RPC URL", bsc],
    ] as const) {
      const url = new URL(value);
      if (url.protocol !== "https:" && url.hostname !== "localhost") {
        throw new Error(`${label} 必须使用 HTTPS`);
      }
    }
    this.coinGeckoDemoApiKeyValue = key;
    this.ethereumRpcUrl = ethereum;
    this.bscRpcUrl = bsc;
    this.verifiedAt = this.clock.now().toISOString();
    return this.status();
  }

  async coinGeckoDemoApiKey(): Promise<string | null> {
    return this.coinGeckoDemoApiKeyValue;
  }

  async rpcUrl(chain: EvmChain): Promise<string | null> {
    return chain === "ethereum" ? this.ethereumRpcUrl : this.bscRpcUrl;
  }
}