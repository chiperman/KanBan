import type {
  AssetCardStore,
  AssetFullRefreshState,
  AssetSourceSummary,
  AssetSources,
  Card,
  Clock,
  CreateManualAssetSourceInput,
  DailyAssetSnapshot,
  DailyAssetSourceSnapshot,
  DailyAssetSnapshots,
  FormalDailySettlement,
  FormalDailySettlementRunner,
  FormalDailySettlements,
  ImportedAssetSourceHistoryObservation,
  InvestmentCashflow,
  ManualAssetRecord,
  ManualAssetRecordInput,
  ManualAssetRecords,
} from "@/server/ports";
import type { InvestmentCashflowStore } from "@/server/investment-cashflows";
import {
  buildDailyAssetSnapshot,
  mergeDailyTrendObservation,
  shanghaiDay,
} from "@/domain/daily-asset-snapshots";
import { decimalAdd } from "@/domain/decimal";
import { assertManualAssetRecordNotFuture } from "@/domain/manual-asset-records";

export class InMemoryAssetCardStore implements AssetCardStore {
  private cards: Card[] = [];

  async list(): Promise<Card[]> {
    return this.cards;
  }

  async replaceAll(cards: Card[]): Promise<void> {
    this.cards = cards;
  }
}

export class InMemoryInvestmentCashflowStore
  implements InvestmentCashflowStore
{
  private cashflows: InvestmentCashflow[] = [];

  async listInvestmentCashflows(): Promise<InvestmentCashflow[]> {
    return structuredClone(this.cashflows);
  }

  async createInvestmentCashflow(cashflow: InvestmentCashflow): Promise<void> {
    this.cashflows.push(structuredClone(cashflow));
  }

  async updateInvestmentCashflow(cashflow: InvestmentCashflow): Promise<void> {
    const index = this.cashflows.findIndex(({ id }) => id === cashflow.id);
    if (index === -1) throw new Error("资金记录不存在");
    this.cashflows[index] = structuredClone(cashflow);
  }

  async deleteInvestmentCashflow(id: string): Promise<void> {
    const count = this.cashflows.length;
    this.cashflows = this.cashflows.filter((cashflow) => cashflow.id !== id);
    if (this.cashflows.length === count) throw new Error("资金记录不存在");
  }
}

export class FakeAssetSources implements AssetSources {
  private sources: AssetSourceSummary[] = [];

  async list(): Promise<AssetSourceSummary[]> {
    return this.sources;
  }

  async replaceAll(sources: AssetSourceSummary[]): Promise<void> {
    this.sources = sources;
  }

  async update(source: AssetSourceSummary): Promise<void> {
    const index = this.sources.findIndex((item) => item.id === source.id);
    if (index === -1) return;
    this.sources = this.sources.map((item) =>
      item.id === source.id ? source : item,
    );
  }
}

export class InMemoryDailyAssetSnapshots implements DailyAssetSnapshots {
  private snapshots: DailyAssetSnapshot[] = [];
  private trendObservations: DailyAssetSnapshot[] = [];
  private importedSourceHistoryObservations:
    ImportedAssetSourceHistoryObservation[] = [];

  async list(): Promise<DailyAssetSnapshot[]> {
    return this.snapshots;
  }

  async listTrendObservations(): Promise<DailyAssetSnapshot[]> {
    return this.trendObservations;
  }

  async listImportedSourceHistoryObservations(): Promise<
    ImportedAssetSourceHistoryObservation[]
  > {
    return structuredClone(this.importedSourceHistoryObservations);
  }

  seedImportedSourceHistory(
    observations: ImportedAssetSourceHistoryObservation[],
  ): void {
    this.importedSourceHistoryObservations = structuredClone(observations);
  }

  async createIfAbsent(snapshot: DailyAssetSnapshot): Promise<boolean> {
    const existing = this.snapshots.find(({ day }) => day === snapshot.day);
    if (existing) return false;
    this.snapshots = [...this.snapshots, snapshot].sort((left, right) =>
      left.day.localeCompare(right.day),
    );
    this.trendObservations = [
      ...this.trendObservations.filter(({ day }) => day !== snapshot.day),
      structuredClone(snapshot),
    ].sort((left, right) => left.day.localeCompare(right.day));
    return true;
  }

  async record(snapshot: DailyAssetSnapshot, createBaseline: boolean): Promise<void> {
    const previous = this.trendObservations.find(row => row.day === snapshot.day);
    const merged = mergeDailyTrendObservation(previous, snapshot);
    const baselineIndex = this.snapshots.findIndex(row => row.day === snapshot.day);
    if (createBaseline && merged.complete && merged.status === "complete") {
      if (baselineIndex === -1) await this.createIfAbsent(merged);
      else if (this.snapshots[baselineIndex].status !== "complete") this.snapshots[baselineIndex] = structuredClone(merged);
    }
    this.trendObservations = [...this.trendObservations.filter(row => row.day !== snapshot.day), structuredClone(merged)]
      .sort((a, b) => a.day.localeCompare(b.day));
  }

  async recordManual(
    source: DailyAssetSourceSnapshot,
    day: string,
    currentObservation: DailyAssetSnapshot | null,
  ): Promise<void> {
    const replaceManualSource = (
      previous: DailyAssetSnapshot,
    ): DailyAssetSnapshot => {
      const sources = [
        ...previous.sources.filter((item) => item.sourceId !== source.sourceId),
        source,
      ];
      const total = {
        USD: sources.some((item) => item.total.USD !== null)
          ? decimalAdd(...sources.flatMap((item) => item.total.USD ?? []))
          : null,
        CNY: sources.some((item) => item.total.CNY !== null)
          ? decimalAdd(...sources.flatMap((item) => item.total.CNY ?? []))
          : null,
        HKD: sources.some((item) => item.total.HKD !== null)
          ? decimalAdd(...sources.flatMap((item) => item.total.HKD ?? []))
          : null,
      };
      const complete =
        total.USD !== null &&
        total.HKD !== null &&
        sources.every((item) => item.complete);
      return {
        ...previous,
        sources,
        total,
        complete,
        status: sources.some((item) => item.status === "expired")
          ? "expired"
          : complete
            ? "complete"
            : "incomplete",
      };
    };
    const baselineIndex = this.snapshots.findIndex(
      (snapshot) => snapshot.day === day,
    );
    if (baselineIndex === -1) {
      const snapshot = currentObservation === null
        ? {
            day,
            capturedAt: source.capturedAt,
            exchangeRates: [],
            complete: false,
            status: "incomplete" as const,
            total: source.total,
            sources: [source],
          }
        : replaceManualSource(currentObservation);
      this.snapshots = [...this.snapshots, structuredClone(snapshot)].sort(
        (left, right) => left.day.localeCompare(right.day),
      );
    }
    const trendIndex = this.trendObservations.findIndex(
      (snapshot) => snapshot.day === day,
    );
    if (trendIndex === -1) {
      const snapshot = currentObservation === null
        ? {
            day,
            capturedAt: source.capturedAt,
            exchangeRates: [],
            complete: false,
            status: "incomplete" as const,
            total: source.total,
            sources: [source],
          }
        : replaceManualSource(currentObservation);
      this.trendObservations = [...this.trendObservations, structuredClone(snapshot)]
        .sort((left, right) => left.day.localeCompare(right.day));
    } else {
      this.trendObservations[trendIndex] = replaceManualSource(
        this.trendObservations[trendIndex],
      );
    }
  }

  removeSource(sourceId: string): void {
    const remove = (snapshot: DailyAssetSnapshot): DailyAssetSnapshot | null => {
      const sources = snapshot.sources.filter((source) => source.sourceId !== sourceId);
      if (sources.length === 0) return null;
      const total = {
        USD: sources.some((source) => source.total.USD !== null)
          ? decimalAdd(...sources.flatMap((source) => source.total.USD ?? []))
          : null,
        CNY: sources.some((source) => source.total.CNY !== null)
          ? decimalAdd(...sources.flatMap((source) => source.total.CNY ?? []))
          : null,
        HKD: sources.some((source) => source.total.HKD !== null)
          ? decimalAdd(...sources.flatMap((source) => source.total.HKD ?? []))
          : null,
      };
      return {
        ...snapshot,
        sources,
        total,
        complete:
          sources.every((source) => source.complete) &&
          total.USD !== null &&
          total.HKD !== null,
      };
    };
    this.snapshots = this.snapshots.flatMap((snapshot) => {
      const updated = remove(snapshot);
      return updated ? [updated] : [];
    });
    this.trendObservations = this.trendObservations.flatMap((snapshot) => {
      const updated = remove(snapshot);
      return updated ? [updated] : [];
    });
  }
}

export class InMemoryAssetFullRefreshState implements AssetFullRefreshState {
  private attemptedAt: string | null = null;
  private inProgressAt: string | null = null;

  async read() {
    return { attemptedAt: this.attemptedAt, inProgressAt: this.inProgressAt };
  }

  async initialize(attemptedAt: string): Promise<boolean> {
    if (this.attemptedAt !== null) return false;
    this.attemptedAt = attemptedAt;
    return true;
  }

  async claim(input: {
    attemptedAt: string;
    intervalMs: number;
    staleAfterMs: number;
    force: boolean;
  }): Promise<"claimed" | "not-due" | "in-progress"> {
    const now = Date.parse(input.attemptedAt);
    const inProgress = this.inProgressAt === null
      ? Number.NaN
      : Date.parse(this.inProgressAt);
    if (
      this.inProgressAt !== null &&
      Number.isFinite(now) &&
      Number.isFinite(inProgress) &&
      now - inProgress < input.staleAfterMs
    ) {
      return "in-progress";
    }
    const previous = this.attemptedAt === null
      ? Number.NaN
      : Date.parse(this.attemptedAt);
    if (
      !input.force &&
      Number.isFinite(now) &&
      Number.isFinite(previous) &&
      now - previous < input.intervalMs
    ) {
      return "not-due";
    }
    this.attemptedAt = input.attemptedAt;
    this.inProgressAt = input.attemptedAt;
    return "claimed";
  }

  async start(attemptedAt: string): Promise<void> {
    this.attemptedAt = attemptedAt;
    this.inProgressAt = attemptedAt;
  }

  async finish(attemptedAt?: string): Promise<void> {
    if (attemptedAt === undefined || this.inProgressAt === attemptedAt) {
      this.inProgressAt = null;
    }
  }

  async clear(): Promise<void> {
    this.attemptedAt = null;
    this.inProgressAt = null;
  }
}

export class InMemoryFormalDailySettlements implements FormalDailySettlements {
  private settlements: FormalDailySettlement[] = [];

  async list(): Promise<FormalDailySettlement[]> {
    return structuredClone(this.settlements);
  }

  async recordIfAbsent(settlement: FormalDailySettlement): Promise<boolean> {
    if (
      this.settlements.some(
        (existing) => existing.anchor.key === settlement.anchor.key,
      )
    ) {
      return false;
    }
    this.settlements = [structuredClone(settlement), ...this.settlements];
    return true;
  }
}

export class NotDueFormalDailySettlementRunner implements FormalDailySettlementRunner {
  async run() {
    return { outcome: "not-due" as const };
  }
}

export class InMemoryManualAssetRecords implements ManualAssetRecords {
  private records: ManualAssetRecord[] = [];
  constructor(
    private readonly sources: FakeAssetSources,
    private readonly cards: InMemoryAssetCardStore,
    private readonly dailySnapshots: InMemoryDailyAssetSnapshots,
    private readonly clock: Clock,
  ) {}

  async create(input: CreateManualAssetSourceInput): Promise<void> {
    const sourceId = `test-manual-source-${(await this.sources.list()).length + 1}`;
    const capturedAt = this.clock.now().toISOString();
    const source: AssetSourceSummary = {
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
    };
    const sources = [...(await this.sources.list()), source];
    await this.sources.replaceAll(sources);
    await this.cards.replaceAll([
      ...(await this.cards.list()),
      {
        id: `test-manual-card-${sourceId}`,
        kind: "asset",
        title: "手工资产记录",
        body: "每日记录资产总额",
        sourceId,
        span: 1,
      },
    ]);
  }

  async record(
    sourceId: string,
    input: ManualAssetRecordInput,
  ): Promise<void> {
    const capturedAt = this.clock.now().toISOString();
    assertManualAssetRecordNotFuture(input.day, shanghaiDay(capturedAt));
    const sources = await this.sources.list();
    const source = sources.find((item) => item.id === sourceId);
    if (!source) throw new Error("资产来源不存在");
    if (source.kind !== "manual") {
      throw new Error("只有手工资产记录可以编辑今日总额");
    }
    const record: ManualAssetRecord = { sourceId, ...input, recordedAt: capturedAt };
    this.records = [
      ...this.records.filter(
        (record) => record.sourceId !== sourceId || record.day !== input.day,
      ),
      record,
    ];
    const latest = this.records
      .filter((record) => record.sourceId === sourceId)
      .toSorted((left, right) => right.day.localeCompare(left.day))[0]!;
    const updatedManualSource = {
      ...source,
      hasManualRecord: true,
      snapshot: {
        ...source.snapshot,
        total: { amount: latest.amount, currency: latest.currency },
        syncedAt: latest.recordedAt,
      },
      sync: {
        status: "current" as const,
        lastSuccessfulAt: capturedAt,
        lastAttemptAt: capturedAt,
        error: null,
        failedMode: null,
      },
    };
    const updatedSources = sources.map((item) =>
      item.id === sourceId ? updatedManualSource : item,
    );
    await this.sources.replaceAll(updatedSources);
    const currentObservation = input.day === shanghaiDay(capturedAt)
      ? buildDailyAssetSnapshot(updatedSources, capturedAt)
      : null;
    const manualSource: DailyAssetSourceSnapshot = currentObservation?.sources.find(
      (item) => item.sourceId === sourceId,
    ) ?? {
      sourceId,
      label: updatedManualSource.label,
      kind: "manual",
      capturedAt: record.recordedAt,
      complete: true,
      status: "complete",
      total: {
        USD: record.currency === "USD" ? record.amount : null,
        CNY: record.currency === "CNY" ? record.amount : null,
        HKD: record.currency === "HKD" ? record.amount : null,
      },
    };
    await this.dailySnapshots.recordManual(
      manualSource,
      input.day,
      currentObservation,
    );
  }

  async list(): Promise<ManualAssetRecord[]> {
    return this.records.toSorted((left, right) =>
      left.sourceId.localeCompare(right.sourceId) || right.day.localeCompare(left.day),
    );
  }

  async delete(sourceId: string, day: string): Promise<void> {
    const index = this.records.findIndex(
      (record) => record.sourceId === sourceId && record.day === day,
    );
    if (index === -1) throw new Error("指定日期没有手工资产记录");
    this.records.splice(index, 1);
    const sources = await this.sources.list();
    const source = sources.find((item) => item.id === sourceId);
    if (!source || source.kind !== "manual") throw new Error("只有手工资产记录可以删除");
    const latest = this.records
      .filter((record) => record.sourceId === sourceId)
      .toSorted((left, right) => right.day.localeCompare(left.day))[0];
    await this.sources.replaceAll(sources.map((item) => item.id !== sourceId ? item : {
      ...item,
      hasManualRecord: latest !== undefined,
      snapshot: { ...item.snapshot, total: latest ? { amount: latest.amount, currency: latest.currency } : { amount: "0", currency: "CNY" } },
    }));
  }
}