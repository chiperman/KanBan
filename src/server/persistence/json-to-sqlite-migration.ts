import { chmodSync, copyFileSync, existsSync, readFileSync } from "node:fs";

import { parseLegacyDashboardStateSync } from "./migrations";
import { SqliteDashboardDatabase } from "./sqlite-database";
import type { BusinessDataState } from "@/server/business-data-backup";

export interface JsonToSqliteMigrationInput {
  databasePath: string;
  dashboardPath: string;
  cardsPath: string;
}

function ensureBackup(sourcePath: string): void {
  if (!existsSync(sourcePath)) return;
  const backupPath = `${sourcePath}.migration-backup`;
  const source = readFileSync(sourcePath);
  if (existsSync(backupPath)) {
    if (!source.equals(readFileSync(backupPath))) {
      throw new Error(`迁移备份与旧文件不一致: ${backupPath}`);
    }
    return;
  }
  copyFileSync(sourcePath, backupPath);
  chmodSync(backupPath, 0o600);
}

async function assertEmpty(database: SqliteDashboardDatabase): Promise<void> {
  const [cards, sources, snapshots, trends, imported, manualRecords, cashflows,
    settlements, execution, investmentHistories, investmentRecords, refresh] =
    await Promise.all([
      database.listAssetCards(),
      database.listSources(),
      database.listDailyAssetSnapshots(),
      database.listDailyAssetTrendObservations(),
      database.listImportedSourceHistoryObservations(),
      database.listManualAssetRecords(),
      database.listInvestmentCashflows(),
      database.listFormalDailySettlements(),
      database.latestFormalSettlementExecution(),
      database.listSourceInvestmentHistories(),
      database.listSourceInvestmentRecords(),
      database.readAssetFullRefreshState(),
    ]);
  if (
    cards.length > 0 || sources.length > 0 || snapshots.length > 0 ||
    trends.length > 0 || imported.length > 0 || manualRecords.length > 0 ||
    cashflows.length > 0 || settlements.length > 0 || execution !== null ||
    investmentHistories.length > 0 || investmentRecords.length > 0 ||
    refresh.attemptedAt !== null || refresh.inProgressAt !== null
  ) {
    throw new Error("目标 SQLite 已包含业务数据，拒绝覆盖；请指定新的数据库文件");
  }
}

/** 一次性导入旧 Dashboard JSON；不会删除旧文件，也不会覆盖非空 SQLite。 */
export async function migrateJsonToSqlite(
  input: JsonToSqliteMigrationInput,
): Promise<{ sourceCount: number; cardCount: number; snapshotCount: number }> {
  const state = parseLegacyDashboardStateSync(input.dashboardPath, input.cardsPath);
  const database = new SqliteDashboardDatabase(input.databasePath);
  try {
    await assertEmpty(database);
    ensureBackup(input.dashboardPath);
    ensureBackup(input.cardsPath);
    const businessState: BusinessDataState = {
      ...state,
      investmentCashflows: [],
      formalDailySettlements: [],
    };
    await database.validateBusinessData(businessState);
    await database.replaceBusinessData(businessState);
    return {
      sourceCount: state.assetSources.length,
      cardCount: state.assetCards.length,
      snapshotCount: state.dailyAssetSnapshots.length,
    };
  } finally {
    database.close();
  }
}
