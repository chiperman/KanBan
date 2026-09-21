import { randomUUID } from "node:crypto";

import { buildDailyAssetSnapshot, mergeDailyTrendObservation, shanghaiDay } from "@/domain/daily-asset-snapshots";
import { withEffectiveEvmSnapshotCoverage } from "@/domain/evm-token-preferences";
import { assertManualAssetRecordNotFuture, } from "@/domain/manual-asset-records";
import { parseAssetCards } from "@/server/asset-cards";
import { atomicWritePrivateFile, readPrivateFile } from "@/server/local-data-permissions";
import type { DashboardState } from "@/server/persistence/contracts";
import { DASHBOARD_SCHEMA_VERSION } from "@/server/persistence/contracts";
import { isMissingFile } from "@/server/persistence/file-errors";
import { legacyManualAssetRecords, migrateAssetSource, migrateDailyObservation, migrateManualAssetRecord, uniqueManualAssetRecords } from "@/server/persistence/migrations";
import { applyLatestManualAssetRecord, latestManualAssetRecord, manualDailySource, manualOnlyTrendObservation, mergeManualSourceObservation, withoutSnapshotSource } from "@/server/persistence/observations";
import type { SourceAuthorizationResult, SourceConnectionKind } from "@/server/persistence/source-record";
import { buildConnectedSource, connectedSourceKind } from "@/server/persistence/source-record";
import type { AssetSourceSummary, BinanceAuthorizationResult, BitAuthorizationResult, BitgetAuthorizationResult, Card, CreateManualAssetSourceInput, DailyAssetSnapshot, DailyAssetTrendObservation, EvmWatchAuthorizationResult, ImportedAssetSourceHistoryObservation, LongbridgeAuthorizationResult, ManualAssetClass, ManualAssetRecord, ManualAssetRecordInput, OkxAuthorizationResult } from "@/server/ports";

/** 普通 Dashboard 数据只保存不透明凭证引用，不保存凭证或密文。 */
export class FileDashboardDatabase {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly legacyCardsPath: string,
  ) {}

  private async load(): Promise<DashboardState> {
    let raw: string;
    try {
      raw = await readPrivateFile(this.filePath);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      let assetCards: Card[] = [];
      try {
        const legacy = parseAssetCards(
          JSON.parse(await readPrivateFile(this.legacyCardsPath)),
        );
        if (legacy === null) throw new Error("旧卡片数据格式无效");
        assetCards = legacy;
      } catch (legacyError) {
        if (!isMissingFile(legacyError)) throw legacyError;
      }
      return {
        schemaVersion: DASHBOARD_SCHEMA_VERSION,
        assetCards,
        assetSources: [],
        manualAssetRecords: [],
        dailyAssetSnapshots: [],
        dailyAssetTrendObservations: [],
        importedAssetSourceHistoryObservations: [],
      };
    }
    const value = JSON.parse(raw) as Partial<DashboardState> & {
      cards?: unknown;
    };
    const assetCards = parseAssetCards(value.assetCards ?? value.cards);
    if (
      assetCards === null ||
      !Array.isArray(value.assetSources)
    ) {
      throw new Error(`Dashboard 数据文件格式无效: ${this.filePath}`);
    }
    const assetSources = value.assetSources
      .map(migrateAssetSource)
      .map(withEffectiveEvmSnapshotCoverage);
    const sourceById = new Map(assetSources.map((source) => [source.id, source]));
    const manualAssetRecords = uniqueManualAssetRecords(
      Array.isArray(value.manualAssetRecords)
        ? value.manualAssetRecords
          .map(migrateManualAssetRecord)
          .filter((record) => sourceById.get(record.sourceId)?.kind === "manual")
        : legacyManualAssetRecords(assetSources),
    );
    return {
      schemaVersion: DASHBOARD_SCHEMA_VERSION,
      assetCards,
      assetSources,
      manualAssetRecords,
      dailyAssetSnapshots: Array.isArray(value.dailyAssetSnapshots)
        ? value.dailyAssetSnapshots.map(migrateDailyObservation)
        : [],
      dailyAssetTrendObservations: Array.isArray(value.dailyAssetTrendObservations)
        ? value.dailyAssetTrendObservations.map(migrateDailyObservation)
        : Array.isArray(value.dailyAssetSnapshots)
          ? value.dailyAssetSnapshots.map(migrateDailyObservation)
          : [],
      importedAssetSourceHistoryObservations:
        Array.isArray(value.importedAssetSourceHistoryObservations)
          ? value.importedAssetSourceHistoryObservations as ImportedAssetSourceHistoryObservation[]
          : [],
    };
  }

  private async write(state: DashboardState): Promise<void> {
    await atomicWritePrivateFile(
      this.filePath,
      JSON.stringify(state, null, 2),
    );
  }

  private mutate<T>(operation: (state: DashboardState) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const state = await this.load();
      const result = operation(state);
      await this.write(state);
      return result;
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async listAssetCards(): Promise<Card[]> {
    await this.queue;
    return (await this.load()).assetCards;
  }

  async replaceAssetCards(cards: Card[]): Promise<void> {
    await this.mutate((state) => {
      state.assetCards = cards;
    });
  }

  async listSources(): Promise<AssetSourceSummary[]> {
    await this.queue;
    return (await this.load()).assetSources;
  }

  async replaceSources(sources: AssetSourceSummary[]): Promise<void> {
    await this.mutate((state) => {
      state.assetSources = sources;
      const sourceIds = new Set(sources.map((source) => source.id));
      state.manualAssetRecords = state.manualAssetRecords.filter((record) =>
        sourceIds.has(record.sourceId),
      );
      state.importedAssetSourceHistoryObservations =
        state.importedAssetSourceHistoryObservations.filter((observation) =>
          sourceIds.has(observation.sourceId),
        );
    });
  }

  async updateSource(source: AssetSourceSummary): Promise<void> {
    await this.mutate((state) => {
      const index = state.assetSources.findIndex((item) => item.id === source.id);
      if (index !== -1) state.assetSources[index] = source;
    });
  }

  async listDailyAssetSnapshots(): Promise<DailyAssetSnapshot[]> {
    await this.queue;
    return (await this.load()).dailyAssetSnapshots;
  }

  async listDailyAssetTrendObservations(): Promise<DailyAssetTrendObservation[]> {
    await this.queue;
    return (await this.load()).dailyAssetTrendObservations;
  }

  async listImportedSourceHistoryObservations(): Promise<
    ImportedAssetSourceHistoryObservation[]
  > {
    await this.queue;
    return (await this.load()).importedAssetSourceHistoryObservations;
  }

  async listManualAssetRecords(): Promise<ManualAssetRecord[]> {
    await this.queue;
    return (await this.load()).manualAssetRecords.toSorted(
      (left, right) =>
        left.sourceId.localeCompare(right.sourceId) ||
        right.day.localeCompare(left.day),
    );
  }

  async createDailyAssetSnapshotIfAbsent(
    snapshot: DailyAssetSnapshot,
  ): Promise<boolean> {
    return this.mutate((state) => {
      const existing = state.dailyAssetSnapshots.find(
        ({ day }) => day === snapshot.day,
      );
      if (existing) return false;
      state.dailyAssetSnapshots.push(snapshot);
      state.dailyAssetSnapshots.sort((left, right) =>
        left.day.localeCompare(right.day),
      );
      state.dailyAssetTrendObservations.push(structuredClone(snapshot));
      state.dailyAssetTrendObservations.sort((left, right) =>
        left.day.localeCompare(right.day),
      );
      return true;
    });
  }

  async recordDailyAssetObservation(
    snapshot: DailyAssetTrendObservation,
    createBaseline: boolean,
  ): Promise<void> {
    await this.mutate((state) => {
      const baselineIndex = state.dailyAssetSnapshots.findIndex(
        ({ day }) => day === snapshot.day,
      );
      if (baselineIndex === -1 && createBaseline) {
        state.dailyAssetSnapshots.push(structuredClone(snapshot));
        state.dailyAssetSnapshots.sort((left, right) => left.day.localeCompare(right.day));
      } else if (
        createBaseline &&
        state.dailyAssetSnapshots[baselineIndex].status === "expired"
      ) {
        state.dailyAssetSnapshots[baselineIndex] = structuredClone(snapshot);
      }
      const index = state.dailyAssetTrendObservations.findIndex(
        ({ day }) => day === snapshot.day,
      );
      if (index === -1) {
        state.dailyAssetTrendObservations.push(structuredClone(snapshot));
      } else {
        state.dailyAssetTrendObservations[index] = mergeDailyTrendObservation(
          state.dailyAssetTrendObservations[index],
          snapshot,
          !createBaseline,
        );
      }
      state.dailyAssetTrendObservations.sort((left, right) =>
        left.day.localeCompare(right.day),
      );
    });
  }

  async setAssetCardHidden(sourceId: string, hidden: boolean): Promise<void> {
    await this.mutate((state) => {
      if (!state.assetSources.some((source) => source.id === sourceId)) {
        throw new Error("资产来源不存在");
      }
      const card = state.assetCards.find(
        (item) => item.kind === "asset" && item.sourceId === sourceId,
      );
      if (!card || card.kind !== "asset") throw new Error("资产卡片不存在");
      card.hidden = hidden;
    });
  }

  async setAssetSourceDisplayName(
    sourceId: string,
    displayName: string | null,
  ): Promise<void> {
    await this.mutate((state) => {
      const source = state.assetSources.find((item) => item.id === sourceId);
      if (!source) throw new Error("资产来源不存在");
      if (displayName === null) delete source.displayName;
      else source.displayName = displayName;
    });
  }

  async setAssetSourceManualClass(
    sourceId: string,
    assetClass: ManualAssetClass | null,
  ): Promise<void> {
    await this.mutate((state) => {
      const source = state.assetSources.find((item) => item.id === sourceId);
      if (!source) throw new Error("资产来源不存在");
      if (source.kind !== "manual") {
        throw new Error("只有手工资产来源可以设置资产类别");
      }
      if (assetClass === null) delete source.manualAssetClass;
      else source.manualAssetClass = assetClass;
    });
  }

  async setAssetSourceEvmTokenPreferences(
    sourceId: string,
    ignoredAssetKeys: string[],
    includedAssetKeys: string[],
  ): Promise<void> {
    await this.mutate((state) => {
      const source = state.assetSources.find((item) => item.id === sourceId);
      if (!source) throw new Error("资产来源不存在");
      if (ignoredAssetKeys.length === 0) delete source.ignoredAssetKeys;
      else source.ignoredAssetKeys = ignoredAssetKeys;
      if (includedAssetKeys.length === 0) delete source.includedAssetKeys;
      else source.includedAssetKeys = includedAssetKeys;
    });
  }

  private recordManualDailyObservation(
    state: DashboardState,
    source: AssetSourceSummary,
    record: ManualAssetRecord,
    capturedAt: string,
  ): void {
    const isCurrentDay = record.day === shanghaiDay(capturedAt);
    const currentObservation = isCurrentDay
      ? buildDailyAssetSnapshot(state.assetSources, capturedAt)
      : null;
    const manualSource = currentObservation?.sources.find(
      (item) => item.sourceId === source.id,
    ) ?? manualDailySource(source, record);
    const baselineIndex = state.dailyAssetSnapshots.findIndex(
      ({ day }) => day === record.day,
    );
    if (baselineIndex === -1 && currentObservation !== null) {
      state.dailyAssetSnapshots.push(structuredClone(currentObservation));
    }
    const trendIndex = state.dailyAssetTrendObservations.findIndex(
      ({ day }) => day === record.day,
    );
    if (trendIndex === -1 && currentObservation !== null) {
      state.dailyAssetTrendObservations.push(structuredClone(currentObservation));
    } else if (trendIndex === -1) {
      state.dailyAssetTrendObservations.push(
        manualOnlyTrendObservation(record.day, manualSource),
      );
    } else {
      state.dailyAssetTrendObservations[trendIndex] = mergeManualSourceObservation(
        state.dailyAssetTrendObservations[trendIndex],
        manualSource,
      );
    }
    state.dailyAssetSnapshots.sort((left, right) => left.day.localeCompare(right.day));
    state.dailyAssetTrendObservations.sort((left, right) =>
      left.day.localeCompare(right.day),
    );
  }

  private removeManualDailyObservation(
    state: DashboardState,
    sourceId: string,
    day: string,
  ): void {
    const remove = (snapshot: DailyAssetSnapshot): DailyAssetSnapshot | null =>
      withoutSnapshotSource(snapshot, sourceId);
    const baselineIndex = state.dailyAssetSnapshots.findIndex(
      (snapshot) => snapshot.day === day,
    );
    if (baselineIndex !== -1) {
      const next = remove(state.dailyAssetSnapshots[baselineIndex]);
      if (next === null) state.dailyAssetSnapshots.splice(baselineIndex, 1);
      else state.dailyAssetSnapshots[baselineIndex] = next;
    }
    const trendIndex = state.dailyAssetTrendObservations.findIndex(
      (snapshot) => snapshot.day === day,
    );
    if (trendIndex !== -1) {
      const next = remove(state.dailyAssetTrendObservations[trendIndex]);
      if (next === null) state.dailyAssetTrendObservations.splice(trendIndex, 1);
      else state.dailyAssetTrendObservations[trendIndex] = next;
    }
  }

  async createManualAssetSource(
    input: CreateManualAssetSourceInput,
    capturedAt: string,
  ): Promise<void> {
    await this.mutate((state) => {
      const sourceId = randomUUID();
      state.assetSources.push({
        id: sourceId,
        kind: "manual",
        label: input.label,
        hasManualRecord: false,
        accountId: `manual:${sourceId}`,
        permissions: [],
        credentialReference: null,
        snapshot: {
          total: { amount: "0", currency: "CNY" },
          holdings: [],
          exchangeRates: [],
          syncedAt: capturedAt,
        },
        sync: {
          status: "current",
          lastSuccessfulAt: capturedAt,
          lastAttemptAt: capturedAt,
          error: null,
        },
      });
      state.assetCards.push({
        id: randomUUID(),
        kind: "asset",
        title: "手工资产记录",
        body: "每日记录资产总额",
        sourceId,
        span: 1,
      });
    });
  }

  async recordManualAssetSource(
    sourceId: string,
    input: ManualAssetRecordInput,
    capturedAt: string,
  ): Promise<void> {
    await this.mutate((state) => {
      assertManualAssetRecordNotFuture(input.day, shanghaiDay(capturedAt));
      const source = state.assetSources.find((item) => item.id === sourceId);
      if (!source) throw new Error("资产来源不存在");
      if (source.kind !== "manual") {
        throw new Error("只有手工资产记录可以编辑今日总额");
      }
      const record: ManualAssetRecord = {
        sourceId,
        ...input,
        recordedAt: capturedAt,
      };
      state.manualAssetRecords = [
        ...state.manualAssetRecords.filter(
          (item) => item.sourceId !== sourceId || item.day !== input.day,
        ),
        record,
      ];
      const latest = latestManualAssetRecord(
        state.manualAssetRecords.filter((item) => item.sourceId === sourceId),
      );
      const updated = applyLatestManualAssetRecord(source, latest, capturedAt);
      state.assetSources = state.assetSources.map((item) =>
        item.id === sourceId ? updated : item,
      );
      this.recordManualDailyObservation(state, updated, record, capturedAt);
    });
  }

  async deleteManualAssetSourceRecord(
    sourceId: string,
    day: string,
    capturedAt: string,
  ): Promise<void> {
    await this.mutate((state) => {
      const source = state.assetSources.find((item) => item.id === sourceId);
      if (!source) throw new Error("资产来源不存在");
      if (source.kind !== "manual") {
        throw new Error("只有手工资产记录可以删除");
      }
      const recordExists = state.manualAssetRecords.some(
        (record) => record.sourceId === sourceId && record.day === day,
      );
      if (!recordExists) throw new Error("指定日期没有手工资产记录");
      state.manualAssetRecords = state.manualAssetRecords.filter(
        (record) => record.sourceId !== sourceId || record.day !== day,
      );
      const latest = latestManualAssetRecord(
        state.manualAssetRecords.filter((record) => record.sourceId === sourceId),
      );
      state.assetSources = state.assetSources.map((item) =>
        item.id === sourceId
          ? applyLatestManualAssetRecord(item, latest, capturedAt)
          : item,
      );
      this.removeManualDailyObservation(state, sourceId, day);
    });
  }

  async disconnectAssetSource(sourceId: string): Promise<string | null> {
    return this.mutate((state) => {
      const source = state.assetSources.find((item) => item.id === sourceId);
      if (!source) throw new Error("资产来源不存在");
      if (source.kind === "manual") {
        throw new Error("手工资产记录不支持断开");
      }
      source.lifecycle = "disconnected";
      return source.credentialReference;
    });
  }

  async deleteAssetSourceData(sourceId: string): Promise<string | null> {
    return this.mutate((state) => {
      const source = state.assetSources.find((item) => item.id === sourceId);
      if (!source) throw new Error("资产来源不存在");
      state.assetSources = state.assetSources.filter((item) => item.id !== sourceId);
      state.manualAssetRecords = state.manualAssetRecords.filter(
        (record) => record.sourceId !== sourceId,
      );
      state.assetCards = state.assetCards.filter(
        (card) => card.kind !== "asset" || card.sourceId !== sourceId,
      );
      state.dailyAssetSnapshots = state.dailyAssetSnapshots.flatMap((snapshot) => {
        const updated = withoutSnapshotSource(snapshot, sourceId);
        return updated ? [updated] : [];
      });
      state.dailyAssetTrendObservations = state.dailyAssetTrendObservations.flatMap(
        (snapshot) => {
          const updated = withoutSnapshotSource(snapshot, sourceId);
          return updated ? [updated] : [];
        },
      );
      state.importedAssetSourceHistoryObservations =
        state.importedAssetSourceHistoryObservations.filter(
          (observation) => observation.sourceId !== sourceId,
        );
      return source.credentialReference;
    });
  }

  async connectLongbridge(
    result: LongbridgeAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void> {
    return this.connectAssetSource("longbridge", result, credentialReference, capturedAt);
  }

  async connectBinance(
    result: BinanceAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void> {
    return this.connectAssetSource("binance", result, credentialReference, capturedAt);
  }

  async reconnectAssetSource(
    sourceId: string,
    sourceKind: SourceConnectionKind,
    result: SourceAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<string | null> {
    return this.mutate((state) => {
      const index = state.assetSources.findIndex(({ id }) => id === sourceId);
      const source = state.assetSources[index];
      const kind = connectedSourceKind(sourceKind, result);
      if (!source || source.kind !== kind) {
        throw new Error("资产来源不存在或类型不匹配");
      }
      if (source.accountId !== result.account.id) {
        throw new Error("新授权对应的账户与原来源不一致");
      }
      state.assetSources[index] = {
        ...source,
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
      return source.credentialReference;
    });
  }

  async connectOkx(
    result: OkxAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void> {
    return this.connectAssetSource("okx", result, credentialReference, capturedAt);
  }

  async connectBitget(
    result: BitgetAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void> {
    return this.connectAssetSource("bitget", result, credentialReference, capturedAt);
  }

  async connectBit(
    result: BitAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void> {
    return this.connectAssetSource("bit", result, credentialReference, capturedAt);
  }

  async connectEvm(
    result: EvmWatchAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void> {
    return this.connectAssetSource("evm", result, credentialReference, capturedAt);
  }

  private async connectAssetSource(
    sourceKind: SourceConnectionKind,
    result: SourceAuthorizationResult,
    credentialReference: string,
    capturedAt: string,
  ): Promise<void> {
    await this.mutate((state) => {
      const isFirstAutomaticSource = !state.assetSources.some(
        (source) => source.kind !== "manual",
      );
      const connected = buildConnectedSource(
        sourceKind,
        result,
        credentialReference,
      );
      state.assetSources.push(connected.source);
      state.assetCards.push(connected.card);
      const dailySnapshot = buildDailyAssetSnapshot(state.assetSources, capturedAt);
      if (isFirstAutomaticSource && dailySnapshot.complete) {
        const trendIndex = state.dailyAssetTrendObservations.findIndex(
          ({ day }) => day === dailySnapshot.day,
        );
        if (trendIndex === -1) {
          state.dailyAssetTrendObservations.push(structuredClone(dailySnapshot));
        } else {
          state.dailyAssetTrendObservations[trendIndex] = mergeDailyTrendObservation(
            state.dailyAssetTrendObservations[trendIndex],
            dailySnapshot,
            false,
          );
        }
        if (!state.dailyAssetSnapshots.some(({ day }) => day === dailySnapshot.day)) {
          state.dailyAssetSnapshots.push(structuredClone(dailySnapshot));
        }
        state.dailyAssetSnapshots.sort((left, right) => left.day.localeCompare(right.day));
        state.dailyAssetTrendObservations.sort((left, right) => left.day.localeCompare(right.day));
      }
    });
  }
}
