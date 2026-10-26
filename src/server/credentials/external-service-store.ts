import type {
  EvmChain,
  ExternalServiceConfiguration,
  ExternalServiceConfigurationInput,
  ExternalServiceConfigurationStatus,
  SecretStore,
} from "@/server/ports";
import {
  atomicWritePrivateFile,
  readPrivateFile,
} from "@/server/local-data-permissions";

export interface ExternalServiceVerificationInput { coinGeckoDemoApiKey: string; ethereumRpcUrl: string; bscRpcUrl: string }
export type ExternalServiceVerifier = (input: ExternalServiceVerificationInput) => Promise<void>;

interface StoredExternalServiceConfiguration {
  version: 1;
  coinGeckoDemoApiKeyReference: string | null;
  ethereumRpcUrlReference: string | null;
  bscRpcUrlReference: string | null;
  verifiedAt: string | null;
}


function empty(): StoredExternalServiceConfiguration {
  return {
    version: 1,
    coinGeckoDemoApiKeyReference: null,
    ethereumRpcUrlReference: null,
    bscRpcUrlReference: null,
    verifiedAt: null,
  };
}

function status(
  stored: StoredExternalServiceConfiguration,
): ExternalServiceConfigurationStatus {
  return {
    coinGecko: {
      configured: stored.coinGeckoDemoApiKeyReference !== null,
      verifiedAt: stored.coinGeckoDemoApiKeyReference === null
        ? null
        : stored.verifiedAt,
    },
    ethereumRpc: {
      configured: stored.ethereumRpcUrlReference !== null,
      verifiedAt: stored.ethereumRpcUrlReference === null
        ? null
        : stored.verifiedAt,
    },
    bscRpc: {
      configured: stored.bscRpcUrlReference !== null,
      verifiedAt: stored.bscRpcUrlReference === null ? null : stored.verifiedAt,
    },
  };
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT";
}

function text(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} 不能为空`);
  return normalized;
}

function rpcUrl(value: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} 不是有效 URL`);
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new Error(`${label} 必须使用 HTTPS`);
  }
  return parsed.toString();
}

/**
 * 独立于资产来源的本机服务连接配置。
 * 元数据文件只保存 SecretStore 引用，明文只在本次验证请求内存在。
 */
export class FileExternalServiceConfiguration
  implements ExternalServiceConfiguration
{
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly secrets: SecretStore,
    private readonly verifier: ExternalServiceVerifier,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async load(): Promise<StoredExternalServiceConfiguration> {
    try {
      const value: unknown = JSON.parse(await readPrivateFile(this.filePath));
      if (
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value) ||
        (value as { version?: unknown }).version !== 1
      ) {
        throw new Error("外部服务配置文件格式无效");
      }
      const record = value as Partial<StoredExternalServiceConfiguration>;
      const reference = (
        candidate: unknown,
        label: string,
      ): string | null => {
        if (candidate === null) return null;
        if (typeof candidate === "string" && candidate) return candidate;
        throw new Error(`外部服务配置 ${label} 无效`);
      };
      if (
        record.verifiedAt !== null &&
        typeof record.verifiedAt !== "string"
      ) {
        throw new Error("外部服务配置验证时间无效");
      }
      return {
        version: 1,
        coinGeckoDemoApiKeyReference: reference(
          record.coinGeckoDemoApiKeyReference,
          "CoinGecko",
        ),
        ethereumRpcUrlReference: reference(
          record.ethereumRpcUrlReference,
          "Ethereum RPC",
        ),
        bscRpcUrlReference: reference(
          record.bscRpcUrlReference,
          "BSC RPC",
        ),
        verifiedAt: record.verifiedAt ?? null,
      };
    } catch (error) {
      if (isMissingFile(error)) return empty();
      throw error;
    }
  }

  private async write(
    value: StoredExternalServiceConfiguration,
  ): Promise<void> {
    await atomicWritePrivateFile(this.filePath, JSON.stringify(value));
  }

  private async secret(
    reference: string | null,
    label: string,
  ): Promise<string | null> {
    if (reference === null) return null;
    const value = await this.secrets.get(reference);
    if (value === null) {
      throw new Error(`${label} 配置已损坏，请在本机设置中重新保存`);
    }
    return value;
  }

  private serialize<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    const run = this.queue.then(operation);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  status(): Promise<ExternalServiceConfigurationStatus> {
    return this.serialize(async () => status(await this.load()));
  }

  coinGeckoDemoApiKey(): Promise<string | null> {
    return this.serialize(async () => {
      const value = await this.load();
      return this.secret(value.coinGeckoDemoApiKeyReference, "CoinGecko");
    });
  }

  rpcUrl(chain: EvmChain): Promise<string | null> {
    return this.serialize(async () => {
      const value = await this.load();
      return this.secret(
        chain === "ethereum"
          ? value.ethereumRpcUrlReference
          : value.bscRpcUrlReference,
        chain === "ethereum" ? "Ethereum RPC" : "BSC RPC",
      );
    });
  }

  async saveAndVerify(
    input: ExternalServiceConfigurationInput,
  ): Promise<ExternalServiceConfigurationStatus> {
    return this.serialize(async () => {
      const current = await this.load();
      const requested = {
        coinGeckoDemoApiKey: text(
          input.coinGeckoDemoApiKey,
          "CoinGecko Demo API Key",
        ),
        ethereumRpcUrl: text(input.ethereumRpcUrl, "Ethereum RPC URL"),
        bscRpcUrl: text(input.bscRpcUrl, "BSC RPC URL"),
      };
      const values = {
        coinGeckoDemoApiKey:
          requested.coinGeckoDemoApiKey ??
          await this.secret(
            current.coinGeckoDemoApiKeyReference,
            "CoinGecko",
          ),
        ethereumRpcUrl:
          requested.ethereumRpcUrl ??
          await this.secret(current.ethereumRpcUrlReference, "Ethereum RPC"),
        bscRpcUrl:
          requested.bscRpcUrl ??
          await this.secret(current.bscRpcUrlReference, "BSC RPC"),
      };
      if (
        values.coinGeckoDemoApiKey === null ||
        values.ethereumRpcUrl === null ||
        values.bscRpcUrl === null
      ) {
        throw new Error("请一次配置 CoinGecko、Ethereum RPC 与 BSC RPC");
      }
      const verifiedValues = {
        coinGeckoDemoApiKey: values.coinGeckoDemoApiKey,
        ethereumRpcUrl: rpcUrl(
          values.ethereumRpcUrl,
          "Ethereum RPC URL",
        ),
        bscRpcUrl: rpcUrl(values.bscRpcUrl, "BSC RPC URL"),
      };
      await this.verify(verifiedValues);
      const normalizedEthereumRpcUrl = rpcUrl(
        values.ethereumRpcUrl,
        "Ethereum RPC URL",
      );
      const normalizedBscRpcUrl = rpcUrl(values.bscRpcUrl, "BSC RPC URL");

      const createdReferences: string[] = [];
      try {
        const next: StoredExternalServiceConfiguration = {
          version: 1,
          coinGeckoDemoApiKeyReference:
            requested.coinGeckoDemoApiKey === undefined
              ? current.coinGeckoDemoApiKeyReference
              : await this.put(
                requested.coinGeckoDemoApiKey,
                createdReferences,
              ),
          ethereumRpcUrlReference:
            requested.ethereumRpcUrl === undefined
              ? current.ethereumRpcUrlReference
              : await this.put(normalizedEthereumRpcUrl, createdReferences),
          bscRpcUrlReference:
            requested.bscRpcUrl === undefined
              ? current.bscRpcUrlReference
              : await this.put(normalizedBscRpcUrl, createdReferences),
          verifiedAt: this.now().toISOString(),
        };
        await this.write(next);
        await Promise.all([
          current.coinGeckoDemoApiKeyReference !== null &&
          current.coinGeckoDemoApiKeyReference !==
            next.coinGeckoDemoApiKeyReference
            ? this.secrets.remove(current.coinGeckoDemoApiKeyReference).catch(
              () => undefined,
            )
            : undefined,
          current.ethereumRpcUrlReference !== null &&
          current.ethereumRpcUrlReference !== next.ethereumRpcUrlReference
            ? this.secrets.remove(current.ethereumRpcUrlReference).catch(
              () => undefined,
            )
            : undefined,
          current.bscRpcUrlReference !== null &&
          current.bscRpcUrlReference !== next.bscRpcUrlReference
            ? this.secrets.remove(current.bscRpcUrlReference).catch(
              () => undefined,
            )
            : undefined,
        ]);
        return status(next);
      } catch (error) {
        await Promise.all(createdReferences.map((reference) =>
          this.secrets.remove(reference).catch(() => undefined),
        ));
        throw error;
      }
    });
  }

  private async put(value: string, created: string[]): Promise<string> {
    const reference = await this.secrets.put(value);
    created.push(reference);
    return reference;
  }

  private async verify(input: ExternalServiceVerificationInput): Promise<void> {
    await this.verifier(input);
  }
}
