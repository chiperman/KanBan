import type {
  AssetFullRefreshState,
  AssetSourceConnections,
  AssetSourceLifecycle,
  AssetSourceSummary,
  BinanceAuthorizationResult,
  BitAuthorizationResult,
  BitgetAuthorizationResult,
  Clock,
  EvmWatchAuthorizationResult,
  LongbridgeAuthorizationResult,
  OkxAuthorizationResult,
} from "@/server/ports";

export class InMemoryAssetSourceConnections implements AssetSourceConnections {
  private failMessage: string | null = null;

  constructor(
    private readonly sources: FakeAssetSources,
    private readonly cards: InMemoryAssetCardStore,
    private readonly secrets: InMemorySecretStore,
    private readonly dailySnapshots: InMemoryDailyAssetSnapshots,
    private readonly clock: Clock,
    private readonly fullRefreshState: AssetFullRefreshState,
  ) {}

  failNext(message: string | undefined): void {
    this.failMessage = message ?? null;
  }

  private async connect(
    result:
      | LongbridgeAuthorizationResult
      | BinanceAuthorizationResult
      | OkxAuthorizationResult
      | BitgetAuthorizationResult
      | BitAuthorizationResult
      | EvmWatchAuthorizationResult,
    config: { kind: AssetSourceSummary["kind"]; title: string; body: string },
    reconnectSourceId?: string,
  ): Promise<void> {
    const credentialReference = await this.secrets.put(result.credentials);
    if (this.failMessage) {
      const message = this.failMessage;
      this.failMessage = null;
      await this.secrets.remove(credentialReference);
      throw new Error(message);
    }
    const currentSources = await this.sources.list();
    const existing = reconnectSourceId
      ? currentSources.find((source) => source.id === reconnectSourceId)
      : currentSources.find(
          (source) =>
            source.kind === config.kind && source.accountId === result.account.id,
        );
    if (reconnectSourceId) {
      if (!existing || existing.kind !== config.kind) {
        await this.secrets.remove(credentialReference);
        throw new Error("EVM 观察钱包不存在或链不匹配");
      }
    }
    const sourceId =
      existing?.id ??
      `test-${config.kind}-source-${currentSources.length + 1}`;
    const connected: AssetSourceSummary = {
      ...(existing ?? {}),
      id: sourceId,
      kind: config.kind,
      label: result.account.label,
      accountId: result.account.id,
      permissions: result.permissions,
      credentialReference,
      snapshot: result.snapshot,
      lifecycle: "connected",
      sync: {
        status: "current",
        lastSuccessfulAt: result.snapshot.syncedAt,
        lastAttemptAt: result.snapshot.syncedAt,
        error: null,
      },
    };
    const updatedSources: AssetSourceSummary[] = existing
      ? currentSources.map((source) =>
          source.id === sourceId ? connected : source,
        )
      : [
          ...currentSources,
          {
        id: sourceId,
            kind: config.kind,
            label: result.account.label,
            accountId: result.account.id,
            permissions: result.permissions,
            credentialReference,
            snapshot: result.snapshot,
            lifecycle: "connected",
            sync: {
              status: "current",
              lastSuccessfulAt: result.snapshot.syncedAt,
              lastAttemptAt: result.snapshot.syncedAt,
              error: null,
            },
          },
        ];
    await this.sources.replaceAll(updatedSources);
    if (!existing) {
      await this.cards.replaceAll([
        ...(await this.cards.list()),
        {
          id: `test-${config.kind}-card-${sourceId}`,
          kind: "asset",
          title: config.title,
          body: config.body,
          sourceId,
          span: 1,
        },
      ]);
    }
    const isFirstAutomaticSource = !currentSources.some(
      (source) =>
        source.kind !== "manual" &&
        source.lifecycle !== "disconnected" &&
        source.credentialReference !== null,
    );
    const observation = buildDailyAssetSnapshot(
      updatedSources,
      this.clock.now().toISOString(),
    );
    if (isFirstAutomaticSource && observation.complete) {
      await this.dailySnapshots.record(observation, true);
    }
    if (isFirstAutomaticSource) {
      await this.fullRefreshState.initialize(this.clock.now().toISOString());
    }
    const previousReference = existing?.credentialReference ?? null;
    if (
      previousReference !== null &&
      previousReference !== credentialReference
    ) {
      await this.secrets.remove(previousReference);
    }
  }

  connectLongbridge(result: LongbridgeAuthorizationResult): Promise<void> {
    return this.connect(result, {
      kind: "longbridge",
      title: "长桥资产",
      body: "只读证券账户",
    });
  }

  reconnectLongbridge(
    sourceId: string,
    result: LongbridgeAuthorizationResult,
  ): Promise<void> {
    return this.connect(
      result,
      {
        kind: "longbridge",
        title: "长桥资产",
        body: "只读证券账户",
      },
      sourceId,
    );
  }

  connectBinance(result: BinanceAuthorizationResult): Promise<void> {
    return this.connect(result, {
      kind: "binance",
      title: "Binance 资产",
      body: "投资产品明细、钱包守恒与覆盖状态",
    });
  }

  connectOkx(result: OkxAuthorizationResult): Promise<void> {
    return this.connect(result, {
      kind: "okx",
      title: "OKX 资产",
      body: "现货、资金与 Earn 只读账户",
    });
  }

  connectBitget(result: BitgetAuthorizationResult): Promise<void> {
    return this.connect(result, {
      kind: "bitget",
      title: "Bitget 资产",
      body: "现货、资金与 Earn 只读账户",
    });
  }

  connectBit(result: BitAuthorizationResult): Promise<void> {
    return this.connect(result, {
      kind: "bit",
      title: "BIT / Matrixport 资产",
      body: "Wallet 与理财产品只读账户",
    });
  }

  connectEvm(result: EvmWatchAuthorizationResult): Promise<void> {
    return this.connect(result, {
      kind: result.chain === "ethereum" ? "evm-watch-ethereum" : "evm-watch-bsc",
      title: result.chain === "ethereum" ? "Ethereum 观察钱包" : "BNB Smart Chain 观察钱包",
      body: result.chain === "ethereum"
        ? "公开地址 ETH 与 ERC-20 只读来源"
        : "公开地址 BNB 与 BEP-20 只读来源",
    });
  }

  reconnectEvm(
    sourceId: string,
    result: EvmWatchAuthorizationResult,
  ): Promise<void> {
    return this.connect(
      result,
      {
        kind: result.chain === "ethereum"
          ? "evm-watch-ethereum"
          : "evm-watch-bsc",
        title: result.chain === "ethereum"
          ? "Ethereum 观察钱包"
          : "BNB Smart Chain 观察钱包",
        body: result.chain === "ethereum"
          ? "公开地址 ETH 与 ERC-20 只读来源"
          : "公开地址 BNB 与 BEP-20 只读来源",
      },
      sourceId,
    );
  }
}
import { updateEvmTokenPreferences } from "@/domain/evm-token-preferences";
import { normalizeAssetSourceDisplayName } from "@/domain/asset-source-display-name";
import { buildDailyAssetSnapshot } from "@/domain/daily-asset-snapshots";
import { FakeAssetSources, InMemoryAssetCardStore, InMemoryDailyAssetSnapshots } from "./stores";
import { InMemorySecretStore } from "./credentials";

export class InMemoryAssetSourceLifecycle implements AssetSourceLifecycle {
  constructor(
    private readonly sources: FakeAssetSources,
    private readonly cards: InMemoryAssetCardStore,
    private readonly secrets: InMemorySecretStore,
    private readonly dailySnapshots: InMemoryDailyAssetSnapshots,
    private readonly fullRefreshState: AssetFullRefreshState,
  ) {}

  private async clearCycleWhenNoRefreshableSources(): Promise<void> {
    const hasRefreshableSource = (await this.sources.list()).some(
      (source) =>
        source.kind !== "manual" &&
        source.lifecycle !== "disconnected" &&
        source.credentialReference !== null,
    );
    if (!hasRefreshableSource) await this.fullRefreshState.clear();
  }

  async setHidden(sourceId: string, hidden: boolean): Promise<void> {
    if (!(await this.sources.list()).some((source) => source.id === sourceId)) {
      throw new Error("资产来源不存在");
    }
    const cards = await this.cards.list();
    const card = cards.find(
      (item) => item.kind === "asset" && item.sourceId === sourceId,
    );
    if (!card || card.kind !== "asset") throw new Error("资产卡片不存在");
    await this.cards.replaceAll(
      cards.map((item) => item.id === card.id ? { ...item, hidden } : item),
    );
  }

  async setDisplayName(
    sourceId: string,
    displayName: string,
  ): Promise<void> {
    const sources = await this.sources.list();
    const source = sources.find((item) => item.id === sourceId);
    if (!source) throw new Error("资产来源不存在");
    const normalized = normalizeAssetSourceDisplayName(displayName);
    if (normalized === null) {
      const { displayName: _displayName, ...rest } = source;
      await this.sources.update(rest);
      return;
    }
    await this.sources.update({ ...source, displayName: normalized });
  }

  async setManualAssetClass(
    sourceId: string,
    assetClass: import("@/server/ports").ManualAssetClass | null,
  ): Promise<void> {
    const sources = await this.sources.list();
    const source = sources.find((item) => item.id === sourceId);
    if (!source) throw new Error("资产来源不存在");
    if (source.kind !== "manual") {
      throw new Error("只有手工资产来源可以设置资产类别");
    }
    if (assetClass === null) {
      const { manualAssetClass: _manualAssetClass, ...rest } = source;
      await this.sources.update(rest);
      return;
    }
    await this.sources.update({ ...source, manualAssetClass: assetClass });
  }

  async setEvmTokenPreference(
    sourceId: string,
    assetKeys: string[],
    status: "included" | "ignored" | "unrecognized",
  ): Promise<void> {
    const sources = await this.sources.list();
    const source = sources.find((item) => item.id === sourceId);
    if (!source) throw new Error("资产来源不存在");
    const preferences = updateEvmTokenPreferences(
      source,
      assetKeys,
      status,
    );
    const {
      ignoredAssetKeys: _ignoredAssetKeys,
      includedAssetKeys: _includedAssetKeys,
      ...rest
    } = source;
    await this.sources.update({
      ...rest,
      ...(preferences.ignoredAssetKeys.length === 0
        ? {}
        : { ignoredAssetKeys: preferences.ignoredAssetKeys }),
      ...(preferences.includedAssetKeys.length === 0
        ? {}
        : { includedAssetKeys: preferences.includedAssetKeys }),
    });
  }

  async disconnect(sourceId: string): Promise<void> {
    const sources = await this.sources.list();
    const source = sources.find((item) => item.id === sourceId);
    if (!source) throw new Error("资产来源不存在");
    if (source.kind === "manual") {
      throw new Error("手工资产记录不支持断开");
    }
    await this.sources.update({ ...source, lifecycle: "disconnected" });
    await this.clearCycleWhenNoRefreshableSources();
  }

  async restore(sourceId: string): Promise<void> {
    const source = (await this.sources.list()).find((item) => item.id === sourceId);
    if (!source) throw new Error("资产来源不存在");
    if (source.kind === "manual") {
      throw new Error("手工资产记录不支持恢复连接");
    }
    if (source.lifecycle !== "disconnected") {
      throw new Error("资产来源仍处于连接状态，无需恢复");
    }
    if (
      source.credentialReference === null ||
      (await this.secrets.get(source.credentialReference)) === null
    ) {
      throw new Error(
        "原连接凭证已不存在，无法直接恢复。请重新输入原公开地址；原卡片和历史数据仍保留。",
      );
    }
    await this.sources.update({ ...source, lifecycle: "connected" });
  }

  async deleteData(sourceId: string): Promise<void> {
    const sources = await this.sources.list();
    const source = sources.find((item) => item.id === sourceId);
    if (!source) throw new Error("资产来源不存在");
    await this.sources.replaceAll(sources.filter((item) => item.id !== sourceId));
    await this.cards.replaceAll(
      (await this.cards.list()).filter(
        (card) => card.kind !== "asset" || card.sourceId !== sourceId,
      ),
    );
    this.dailySnapshots.removeSource(sourceId);
    if (source.credentialReference !== null) {
      await this.secrets.remove(source.credentialReference);
    }
    await this.clearCycleWhenNoRefreshableSources();
  }
}