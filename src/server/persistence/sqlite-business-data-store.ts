import type { DatabaseSync } from "node:sqlite";
import type { BusinessDataState } from "@/server/backup/document-codec";
import type { DashboardState, SqliteRow } from "@/server/persistence/contracts";
import { migrateDailyObservation } from "@/server/persistence/migrations";
import type { SqliteFormalSettlementStore } from "./sqlite-formal-settlements";
import type { SqliteInvestmentCashflowStore } from "./sqlite-investment-cashflow-store";
import type { SqliteObservationStore } from "./sqlite-observation-store";
import type { SqliteSourceInvestmentStore } from "./sqlite-source-investment-store";
import type { SqliteAssetCardStore } from "./sqlite-asset-card-store";
import type { SqliteManualAssetRecordStore } from "./sqlite-manual-asset-record-store";
import type { SqliteAssetSourceDataStore } from "./sqlite-asset-source-data-store";

/**
 * 完整业务状态的 SQLite 写入模块；调用方负责事务、完整性校验与提交/回滚。
 * 迁移旧 Dashboard 与恢复业务备份共用同一套写入顺序，避免恢复路径产生第二套语义。
 */
export class SqliteBusinessDataStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly observations: SqliteObservationStore,
    private readonly cashflows: SqliteInvestmentCashflowStore,
    private readonly sourceInvestments: SqliteSourceInvestmentStore,
    private readonly formalSettlements: SqliteFormalSettlementStore,
    private readonly cards: SqliteAssetCardStore,
    private readonly manualRecords: SqliteManualAssetRecordStore,
    private readonly sourceData: SqliteAssetSourceDataStore,
  ) {}

  replace(state: DashboardState | BusinessDataState): void {
    this.database.exec(`
      DELETE FROM investment_cashflows;
      DELETE FROM imported_asset_source_history_observations;
      DELETE FROM daily_asset_source_trend_observations;
      DELETE FROM daily_asset_trend_observations;
      DELETE FROM daily_asset_source_snapshots;
      DELETE FROM daily_asset_snapshots;
      DELETE FROM formal_daily_settlements;
      DELETE FROM asset_source_snapshots;
      DELETE FROM asset_source_sync_states;
      DELETE FROM asset_sources;
    `);

    state.assetSources.forEach((source, position) =>
      this.sourceData.insert(source, position),
    );
    this.cards.replace(state.assetCards);
    state.dailyAssetSnapshots.forEach((snapshot) =>
      this.observations.insertBaseline(migrateDailyObservation(snapshot)),
    );
    state.dailyAssetTrendObservations.forEach((observation) =>
      this.observations.upsertTrend(migrateDailyObservation(observation)),
    );

    const importedHistory = "importedAssetSourceHistoryObservations" in state
      ? state.importedAssetSourceHistoryObservations
      : [];
    importedHistory.forEach((observation) =>
      this.observations.insertImportedHistory(observation),
    );

    const investmentCashflows = "investmentCashflows" in state
      ? state.investmentCashflows
      : [];
    investmentCashflows.forEach((cashflow) => this.cashflows.insert(cashflow));

    if ("sourceInvestmentHistories" in state) {
      for (const history of state.sourceInvestmentHistories ?? []) {
        this.sourceInvestments.writeHistory(history);
      }
    }
    if ("sourceInvestmentRecords" in state) {
      for (const record of state.sourceInvestmentRecords ?? []) {
        this.sourceInvestments.insertRecord(record);
      }
    }

    for (const record of "manualAssetRecords" in state
      ? state.manualAssetRecords
      : []) {
      this.manualRecords.insert(record);
    }

    for (const settlement of "formalDailySettlements" in state
      ? state.formalDailySettlements
      : []) {
      if (!this.formalSettlements.insert(settlement)) {
        throw new Error("正式日结锚点重复");
      }
    }
  }
}
