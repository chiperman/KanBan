import { normalizeAssetSourceDisplayName } from "@/domain/asset-source-display-name";
import { updateEvmTokenPreferences } from "@/domain/evm-token-preferences";
import { isMacOSKeychainCredentialReference } from "@/server/asset-sources/longbridge-keychain-sdk";
import { SystemClock } from "@/server/clock";
import type { TransactionalSecretStore } from "@/server/credentials/secret-store";
import type { DashboardDatabase } from "@/server/persistence/contracts";
import type { SourceAuthorizationResult, SourceConnectionKind } from "@/server/persistence/source-record";
import { connectedSourceKind } from "@/server/persistence/source-record";
import type { AssetFullRefreshState, AssetSourceConnections, AssetSourceLifecycle, BinanceAuthorizationResult, BitAuthorizationResult, BitgetAuthorizationResult, Clock, EvmWatchAuthorizationResult, LongbridgeAuthorizationResult, ManualAssetClass, OkxAuthorizationResult, SecretStore } from "@/server/ports";

export class DatabaseAssetSourceLifecycle implements AssetSourceLifecycle {
  constructor(
    private readonly database: DashboardDatabase,
    private readonly secrets: SecretStore,
    private readonly fullRefreshState: AssetFullRefreshState,
  ) {}

  private async clearCycleWhenNoRefreshableSources(): Promise<void> {
    const hasRefreshableSource = (await this.database.listSources()).some(
      (source) =>
        source.kind !== "manual" &&
        source.lifecycle !== "disconnected" &&
        source.credentialReference !== null,
    );
    if (!hasRefreshableSource) await this.fullRefreshState.clear();
  }

  setHidden(sourceId: string, hidden: boolean): Promise<void> {
    return this.database.setAssetCardHidden(sourceId, hidden);
  }

  setDisplayName(sourceId: string, displayName: string): Promise<void> {
    return this.database.setAssetSourceDisplayName(
      sourceId,
      normalizeAssetSourceDisplayName(displayName),
    );
  }

  setManualAssetClass(
    sourceId: string,
    assetClass: ManualAssetClass | null,
  ): Promise<void> {
    return this.database.setAssetSourceManualClass(sourceId, assetClass);
  }

  async setEvmTokenPreference(
    sourceId: string,
    assetKeys: string[],
    status: "included" | "ignored" | "unrecognized",
  ): Promise<void> {
    const source = (await this.database.listSources()).find(
      (item) => item.id === sourceId,
    );
    if (!source) throw new Error("资产来源不存在");
    const preferences = updateEvmTokenPreferences(
      source,
      assetKeys,
      status,
    );
    await this.database.setAssetSourceEvmTokenPreferences(
      sourceId,
      preferences.ignoredAssetKeys,
      preferences.includedAssetKeys,
    );
  }

  async disconnect(sourceId: string): Promise<void> {
    const source = (await this.database.listSources()).find(
      (item) => item.id === sourceId,
    );
    if (!source) throw new Error("资产来源不存在");
    if (source.kind === "manual") {
      throw new Error("手工资产记录不支持断开");
    }
    if (source.credentialReference !== null) {
      await this.secrets.remove(source.credentialReference);
    }
    await this.database.disconnectAssetSource(sourceId);
    await this.clearCycleWhenNoRefreshableSources();
  }

  async restore(sourceId: string): Promise<void> {
    const source = (await this.database.listSources()).find(
      (item) => item.id === sourceId,
    );
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
    await this.database.updateSource({ ...source, lifecycle: "connected" });
  }

  async deleteData(sourceId: string): Promise<void> {
    const reference = await this.database.deleteAssetSourceData(sourceId);
    if (reference !== null) await this.secrets.remove(reference);
    await this.clearCycleWhenNoRefreshableSources();
  }
}

export class DatabaseAssetSourceConnections implements AssetSourceConnections {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly database: DashboardDatabase,
    private readonly secrets: TransactionalSecretStore,
    private readonly ready: Promise<void> = Promise.resolve(),
    private readonly clock: Clock = new SystemClock(),
    private readonly fullRefreshState: AssetFullRefreshState,
  ) {}

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async connect(
    sourceKind: SourceConnectionKind,
    result:
      | LongbridgeAuthorizationResult
      | BinanceAuthorizationResult
      | OkxAuthorizationResult
      | BitgetAuthorizationResult
      | BitAuthorizationResult
      | EvmWatchAuthorizationResult,
    save: (credentialReference: string, capturedAt: string) => Promise<void>,
  ) {
    await this.ready;
    const capturedAt = this.clock.now().toISOString();
    const usesKeychainReference =
      sourceKind === "longbridge" &&
      isMacOSKeychainCredentialReference(result.credentials);
    const credentialReference = usesKeychainReference
      ? result.credentials
      : await this.secrets.stage(result.credentials);
    let isFirstAutomaticSource: boolean;
    try {
      isFirstAutomaticSource = !(await this.database.listSources()).some(
        (source) =>
          source.kind !== "manual" &&
          source.lifecycle !== "disconnected" &&
          source.credentialReference !== null,
      );
      await save(credentialReference, capturedAt);
    } catch (error) {
      if (usesKeychainReference) throw error;
      try {
        await this.secrets.remove(credentialReference);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "资产来源写入失败，待回收凭证将在启动恢复时清理",
        );
      }
      throw error;
    }
    if (!usesKeychainReference) {
      try {
        await this.secrets.commit(credentialReference);
      } catch (error) {
        try {
          const source = (await this.database.listSources()).find(
            (item) => item.credentialReference === credentialReference,
          );
          if (source) await this.database.deleteAssetSourceData(source.id);
          await this.secrets.remove(credentialReference);
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "凭证提交失败，资产来源补偿回滚也未能完成",
          );
        }
        throw error;
      }
    }
    if (isFirstAutomaticSource) {
      await this.fullRefreshState.initialize(capturedAt);
    }
  }

  private async replaceExisting(
    sourceId: string,
    sourceKind: SourceConnectionKind,
    result: SourceAuthorizationResult,
  ): Promise<void> {
    await this.ready;
    const isFirstAutomaticSource = !(await this.database.listSources()).some(
      (source) =>
        source.kind !== "manual" &&
        source.lifecycle !== "disconnected" &&
        source.credentialReference !== null,
    );
    const capturedAt = this.clock.now().toISOString();
    const usesKeychainReference =
      sourceKind === "longbridge" &&
      isMacOSKeychainCredentialReference(result.credentials);
    const credentialReference = usesKeychainReference
      ? result.credentials
      : await this.secrets.stage(result.credentials);
    if (!usesKeychainReference) {
      try {
        await this.secrets.commit(credentialReference);
      } catch (error) {
        await this.secrets.remove(credentialReference);
        throw error;
      }
    }

    let previousReference: string | null;
    try {
      previousReference = await this.database.reconnectAssetSource(
        sourceId,
        sourceKind,
        result,
        credentialReference,
        capturedAt,
      );
    } catch (error) {
      if (!usesKeychainReference) await this.secrets.remove(credentialReference);
      throw error;
    }
    if (
      previousReference !== null &&
      previousReference !== credentialReference &&
      !isMacOSKeychainCredentialReference(previousReference)
    ) {
      await this.secrets.remove(previousReference);
    }
    if (isFirstAutomaticSource) {
      await this.fullRefreshState.initialize(capturedAt);
    }
  }

  private connectOrReplace(
    sourceKind: SourceConnectionKind,
    result: SourceAuthorizationResult,
    save: (credentialReference: string, capturedAt: string) => Promise<void>,
  ): Promise<void> {
    return this.serialize(() =>
      this.connectOrReplaceSerialized(sourceKind, result, save),
    );
  }

  private async connectOrReplaceSerialized(
    sourceKind: SourceConnectionKind,
    result: SourceAuthorizationResult,
    save: (credentialReference: string, capturedAt: string) => Promise<void>,
  ): Promise<void> {
    await this.ready;
    const kind = connectedSourceKind(sourceKind, result);
    const existing = (await this.database.listSources()).find(
      (source) =>
        source.kind === kind && source.accountId === result.account.id,
    );
    if (existing) {
      await this.replaceExisting(existing.id, sourceKind, result);
      return;
    }
    await this.connect(sourceKind, result, save);
  }

  connectLongbridge(result: LongbridgeAuthorizationResult) {
    return this.connectOrReplace("longbridge", result, (reference, capturedAt) =>
      this.database.connectLongbridge(result, reference, capturedAt));
  }

  async reconnectLongbridge(
    sourceId: string,
    result: LongbridgeAuthorizationResult,
  ): Promise<void> {
    await this.serialize(() =>
      this.replaceExisting(sourceId, "longbridge", result),
    );
  }

  connectBinance(result: BinanceAuthorizationResult) {
    return this.connectOrReplace("binance", result, (reference, capturedAt) =>
      this.database.connectBinance(result, reference, capturedAt));
  }

  connectOkx(result: OkxAuthorizationResult) {
    return this.connectOrReplace("okx", result, (reference, capturedAt) =>
      this.database.connectOkx(result, reference, capturedAt));
  }

  connectBitget(result: BitgetAuthorizationResult) {
    return this.connectOrReplace("bitget", result, (reference, capturedAt) =>
      this.database.connectBitget(result, reference, capturedAt));
  }

  connectBit(result: BitAuthorizationResult) {
    return this.connectOrReplace("bit", result, (reference, capturedAt) =>
      this.database.connectBit(result, reference, capturedAt));
  }

  connectEvm(result: EvmWatchAuthorizationResult) {
    return this.connectOrReplace("evm", result, (reference, capturedAt) =>
      this.database.connectEvm(result, reference, capturedAt));
  }

  async reconnectEvm(
    sourceId: string,
    result: EvmWatchAuthorizationResult,
  ): Promise<void> {
    await this.serialize(() => this.replaceExisting(sourceId, "evm", result));
  }

}
