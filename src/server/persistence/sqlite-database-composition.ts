import { chmodSync } from "node:fs";
import type { DatabaseSync as SqliteConnection } from "node:sqlite";
import { SqliteAssetCardStore } from "./sqlite-asset-card-store";
import { SqliteAssetSourceConnectionStore } from "./sqlite-asset-source-connection-store";
import { SqliteAssetSourceDataStore } from "./sqlite-asset-source-data-store";
import { SqliteAssetSourceReplacementStore } from "./sqlite-asset-source-replacement-store";
import { SqliteBusinessDataStore } from "./sqlite-business-data-store";
import { SqliteDatabaseInitializationStore } from "./sqlite-database-initialization-store";
import { SqliteFormalSettlementExecutionStore } from "./sqlite-formal-settlement-execution-store";
import { SqliteFormalSettlementMarketStore } from "./sqlite-formal-settlement-market-store";
import { SqliteFormalSettlementStore } from "./sqlite-formal-settlements";
import { SqliteInvestmentCashflowStore } from "./sqlite-investment-cashflow-store";
import { SqliteInvestmentBookStore } from "./sqlite-investment-book-store";
import { SqliteManualAssetRecordStore } from "./sqlite-manual-asset-record-store";
import { SqliteManualAssetSourceStore } from "./sqlite-manual-asset-source-store";
import { SqliteMetadataStore } from "./sqlite-metadata-store";
import { SqliteObservationStore } from "./sqlite-observation-store";
import { SqliteDashboardReadModel } from "./sqlite-read-model";
import { SqliteRefreshStateStore } from "./sqlite-refresh-state-store";
import { SqliteSourceInvestmentStore } from "./sqlite-source-investment-store";
import { SqliteTransactionStore } from "./sqlite-transaction-store";

const sqlite = process.getBuiltinModule("node:sqlite");
if (sqlite === undefined) {
  throw new Error("当前 Node.js 运行时不支持 node:sqlite");
}
const { DatabaseSync } = sqlite;

/** 装配共享连接上的 SQLite 模块；启动成功后移交连接，失败时负责关闭。 */
export function openSqliteDashboard(
  databasePath: string,
) {
  let database: SqliteConnection | undefined;
  try {
    database = new DatabaseSync(databasePath);
    const transactions = new SqliteTransactionStore(database, databasePath);
    const cards = new SqliteAssetCardStore(database);
    const metadata = new SqliteMetadataStore(database);
    const manualRecords = new SqliteManualAssetRecordStore(database);
    const sourceData = new SqliteAssetSourceDataStore(database);
    const sourceReplacement = new SqliteAssetSourceReplacementStore(database, sourceData);
    const readModel = new SqliteDashboardReadModel(database);
    const formalSettlements = new SqliteFormalSettlementStore(database);
    const observations = new SqliteObservationStore(database, readModel);
    const sourceInvestments = new SqliteSourceInvestmentStore(database, readModel);
    const manualSources = new SqliteManualAssetSourceStore(
      database, readModel, observations, cards, manualRecords, sourceData,
    );
    const sourceConnections = new SqliteAssetSourceConnectionStore(
      database, sourceData, readModel, observations, cards,
    );
    const investmentCashflows = new SqliteInvestmentCashflowStore(database);
    const investmentBooks = new SqliteInvestmentBookStore(database, readModel);
    const formalSettlementExecutions = new SqliteFormalSettlementExecutionStore(database);
    const formalSettlementMarkets = new SqliteFormalSettlementMarketStore(database);
    const refreshState = new SqliteRefreshStateStore(metadata);
    const businessData = new SqliteBusinessDataStore(
      database, observations, investmentCashflows, sourceInvestments,
      formalSettlements, cards, manualRecords, sourceData,
    );
    const initialization = new SqliteDatabaseInitializationStore(
      database,
      (operation) => transactions.run(operation),
      metadata,
    );

    chmodSync(databasePath, 0o600);
    database.exec("PRAGMA busy_timeout = 5000");
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA synchronous = FULL");
    initialization.initialize();
    transactions.assertIntegrity();
    transactions.hardenFiles();

    return {
      database,
      metadata,
      transactions,
      cards,
      sourceData,
      sourceReplacement,
      readModel,
      formalSettlements,
      observations,
      sourceInvestments,
      manualSources,
      sourceConnections,
      investmentCashflows,
      investmentBooks,
      formalSettlementExecutions,
      formalSettlementMarkets,
      refreshState,
      businessData,
    };
  } catch (error) {
    try {
      database?.close();
    } catch {
      // 保留原始启动错误。
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `SQLite 业务数据初始化失败，已停止启动；请保留 ${databasePath} 后恢复: ${detail}`,
      { cause: error },
    );
  }
}

export type SqliteDashboardComposition = ReturnType<typeof openSqliteDashboard>;
