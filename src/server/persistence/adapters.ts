import type {
  AssetCardDatabase,
  AssetFullRefreshStateDatabase,
  AssetSnapshotDatabase,
  AssetSourceDatabase,
  FormalDailySettlementDatabase,
  FormalSettlementExecutionDatabase,
  ManualAssetRecordDatabase,
} from "@/server/persistence/contracts";
import type { AssetCardStore, AssetFullRefreshState, AssetSources, AssetSourceSummary, Card, Clock, CreateManualAssetSourceInput, DailyAssetSnapshot, DailyAssetSnapshots, DailyAssetTrendObservation, FormalDailySettlement, FormalDailySettlements, FormalSettlementExecution, FormalSettlementExecutions, ManualAssetRecord, ManualAssetRecordInput, ManualAssetRecords } from "@/server/ports";

export class DatabaseAssetCardStore implements AssetCardStore {
  constructor(private readonly database: AssetCardDatabase) {}
  list() { return this.database.listAssetCards(); }
  replaceAll(cards: Card[]) { return this.database.replaceAssetCards(cards); }
}

export class DatabaseAssetSources implements AssetSources {
  constructor(private readonly database: AssetSourceDatabase) {}
  list() { return this.database.listSources(); }
  replaceAll(sources: AssetSourceSummary[]) { return this.database.replaceSources(sources); }
  update(source: AssetSourceSummary) { return this.database.updateSource(source); }
}

export class DatabaseManualAssetRecords implements ManualAssetRecords {
  constructor(
    private readonly database: ManualAssetRecordDatabase,
    private readonly clock: Clock,
  ) {}

  create(input: CreateManualAssetSourceInput): Promise<void> {
    return this.database.createManualAssetSource(
      input,
      this.clock.now().toISOString(),
    );
  }

  list(): Promise<ManualAssetRecord[]> {
    return this.database.listManualAssetRecords();
  }

  record(
    sourceId: string,
    input: ManualAssetRecordInput,
  ): Promise<void> {
    return this.database.recordManualAssetSource(
      sourceId,
      input,
      this.clock.now().toISOString(),
    );
  }

  delete(sourceId: string, day: string): Promise<void> {
    return this.database.deleteManualAssetSourceRecord(
      sourceId,
      day,
      this.clock.now().toISOString(),
    );
  }
}

export class DatabaseDailyAssetSnapshots implements DailyAssetSnapshots {
  constructor(private readonly database: AssetSnapshotDatabase) {}
  list() { return this.database.listDailyAssetSnapshots(); }
  listTrendObservations() {
    return this.database.listDailyAssetTrendObservations();
  }
  listImportedSourceHistoryObservations() {
    return this.database.listImportedSourceHistoryObservations();
  }
  createIfAbsent(snapshot: DailyAssetSnapshot) {
    return this.database.createDailyAssetSnapshotIfAbsent(snapshot);
  }
  record(snapshot: DailyAssetTrendObservation, createBaseline: boolean) {
    return this.database.recordDailyAssetObservation(snapshot, createBaseline);
  }
}

export class DatabaseAssetFullRefreshState implements AssetFullRefreshState {
  constructor(private readonly database: AssetFullRefreshStateDatabase) {}

  read() { return this.database.readAssetFullRefreshState(); }
  initialize(attemptedAt: string) {
    return this.database.initializeAssetFullRefresh(attemptedAt);
  }
  claim(input: {
    attemptedAt: string;
    intervalMs: number;
    staleAfterMs: number;
    force: boolean;
  }) {
    return this.database.claimAssetFullRefresh(input);
  }
  start(attemptedAt: string) {
    return this.database.startAssetFullRefresh(attemptedAt);
  }
  finish(attemptedAt?: string) {
    return this.database.finishAssetFullRefresh(attemptedAt);
  }
  clear() { return this.database.clearAssetFullRefresh(); }
}

export class DatabaseFormalSettlementExecutions implements FormalSettlementExecutions {
  constructor(private readonly database: FormalSettlementExecutionDatabase) {}
  latest() { return this.database.latestFormalSettlementExecution(); }
  record(execution: FormalSettlementExecution) {
    return this.database.recordFormalSettlementExecution(execution);
  }
}

export class DatabaseFormalDailySettlements implements FormalDailySettlements {
  constructor(private readonly database: FormalDailySettlementDatabase) {}

  list() {
    return this.database.listFormalDailySettlements();
  }

  recordIfAbsent(settlement: FormalDailySettlement) {
    return this.database.recordFormalDailySettlementIfAbsent(settlement);
  }
}
