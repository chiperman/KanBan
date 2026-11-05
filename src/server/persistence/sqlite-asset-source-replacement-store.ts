import type { DatabaseSync } from "node:sqlite";
import type { AssetSourceSummary } from "@/server/ports";
import type { SqliteAssetSourceDataStore } from "./sqlite-asset-source-data-store";

/** 来源集合替换写入模块；事务边界由调用方持有。 */
export class SqliteAssetSourceReplacementStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sourceData: SqliteAssetSourceDataStore,
  ) {}

  replace(sources: AssetSourceSummary[]): void {
    this.database.exec(`
      DELETE FROM formal_daily_settlements;
      DELETE FROM asset_source_snapshots;
      DELETE FROM asset_source_sync_states;
      DELETE FROM asset_sources;
    `);
    sources.forEach((source, position) =>
      this.sourceData.insert(source, position),
    );
  }
}
