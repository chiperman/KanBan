import type { SourceInvestmentHistory } from "@/domain/source-investment-history";
import type { SourceInvestmentRecord } from "@/domain/source-investment-records";
import type { InvestmentCashflow } from "@/server/ports";
import type { SqliteRow } from "@/server/persistence/contracts";
import type {
  AssetSourceSummary,
  DailyAssetSnapshot,
  DailyAssetTrendObservation,
  FormalDailySettlement,
  ImportedAssetSourceHistoryObservation,
  ManualAssetRecord,
} from "@/server/ports";
import type { DatabaseSync } from "node:sqlite";
import { SqliteFormalSettlementReadStore } from "./sqlite-formal-settlement-read-store";
import { SqliteInvestmentReadStore } from "./sqlite-investment-read-store";
import { SqliteObservationReadStore } from "./sqlite-observation-read-store";
import { SqliteSourceReadStore } from "./sqlite-source-read-store";

/** SQLite 只读门面；按来源、观测、投资与正式日结领域委托查询模块。 */
export class SqliteDashboardReadModel {
  private readonly sources: SqliteSourceReadStore;
  private readonly observations: SqliteObservationReadStore;
  private readonly investments: SqliteInvestmentReadStore;
  private readonly formalSettlements: SqliteFormalSettlementReadStore;

  constructor(private readonly database: DatabaseSync) {
    this.sources = new SqliteSourceReadStore(database);
    this.observations = new SqliteObservationReadStore(database);
    this.investments = new SqliteInvestmentReadStore(database);
    this.formalSettlements = new SqliteFormalSettlementReadStore(database);
  }

  dailySourceRows(
    day: string,
    table: "daily_asset_source_snapshots" | "daily_asset_source_trend_observations" = "daily_asset_source_snapshots",
  ): SqliteRow[] {
    return this.observations.dailySourceRows(day, table);
  }

  listSourcesSync(detailSourceId?: string): AssetSourceSummary[] {
    return this.sources.listSourcesSync(detailSourceId);
  }

  listManualAssetRecordsSync(sourceId?: string): ManualAssetRecord[] {
    return this.sources.listManualAssetRecordsSync(sourceId);
  }

  listInvestmentCashflowsSync(): InvestmentCashflow[] {
    return this.investments.listInvestmentCashflowsSync();
  }

  listDailyAssetSnapshotsSync(): DailyAssetSnapshot[] {
    return this.observations.listDailyAssetSnapshotsSync();
  }

  listDailyAssetTrendObservationsSync(): DailyAssetTrendObservation[] {
    return this.observations.listDailyAssetTrendObservationsSync();
  }

  listImportedSourceHistoryObservationsSync(): ImportedAssetSourceHistoryObservation[] {
    return this.observations.listImportedSourceHistoryObservationsSync();
  }

  listDailyObservationsSync(
    snapshotTable: "daily_asset_snapshots" | "daily_asset_trend_observations",
    sourceTable: "daily_asset_source_snapshots" | "daily_asset_source_trend_observations",
    day?: string,
    query?: { sourceId: string; from?: string; to?: string },
  ): DailyAssetSnapshot[] {
    return this.observations.listDailyObservationsSync(
      snapshotTable,
      sourceTable,
      day,
      query,
    );
  }

  readSourceDetail(query: { sourceId: string; from?: string; to?: string }) {
    const investmentHistory = this.investments.getSourceInvestmentHistory(query.sourceId);
    const investmentRecords = this.investments.listSourceInvestmentRecordsSync(query.sourceId);
    return {
      sources: this.sources.listSourcesSync(query.sourceId),
      manualRecords: this.sources.listManualAssetRecordsSync(query.sourceId),
      history: this.observations.listDailyObservationsSync(
        "daily_asset_trend_observations",
        "daily_asset_source_trend_observations",
        undefined,
        query,
      ),
      firstDay: [
        this.observations.firstSourceObservationDay(query.sourceId),
        investmentHistory?.openingInvestment.day,
        investmentRecords[0]?.day,
      ].filter((day): day is string => day !== undefined).sort()[0],
      investmentHistory,
      investmentRecords,
    };
  }

  listSourceInvestmentRecordsSync(sourceId?: string): SourceInvestmentRecord[] {
    return this.investments.listSourceInvestmentRecordsSync(sourceId);
  }

  listSourceInvestmentHistories(): SourceInvestmentHistory[] {
    return this.investments.listSourceInvestmentHistories();
  }

  listFormalDailySettlementsSync(): FormalDailySettlement[] {
    return this.formalSettlements.list();
  }
}
