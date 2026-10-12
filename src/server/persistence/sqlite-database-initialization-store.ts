import { copyFileSync, existsSync, chmodSync, readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { parseLegacyDashboardStateSync } from "@/server/persistence/migrations";
import { DashboardSchema } from "./sqlite-schema";
import type { SqliteBusinessDataStore } from "./sqlite-business-data-store";
import type { SqliteMetadataStore } from "./sqlite-metadata-store";

type Transaction = <T>(operation: () => T) => T;

/** SQLite 建表、Schema 迁移与旧 JSON 导入模块；事务边界由调用方持有。 */
export class SqliteDatabaseInitializationStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly transaction: Transaction,
    private readonly metadataStore: SqliteMetadataStore,
    private readonly businessData: SqliteBusinessDataStore,
    private readonly legacyDashboardPath: string,
    private readonly legacyCardsPath: string,
  ) {}

  initialize(): void {
    new DashboardSchema(
      this.database,
      this.transaction,
      (key) => this.metadataStore.get(key),
    ).createSchema();
    if (this.metadataStore.get("json_import_complete") === "1") return;

    const state = parseLegacyDashboardStateSync(
      this.legacyDashboardPath,
      this.legacyCardsPath,
    );
    this.transaction(() => {
      this.businessData.replace(state);
      this.backupLegacyDashboard();
      this.metadataStore.set("json_import_complete", "1");
    });
  }

  private backupLegacyDashboard(): void {
    if (!existsSync(this.legacyDashboardPath)) return;
    const backupPath = `${this.legacyDashboardPath}.migration-backup`;
    const source = readFileSync(this.legacyDashboardPath);
    if (existsSync(backupPath)) {
      if (!source.equals(readFileSync(backupPath))) {
        throw new Error(`迁移备份与旧 Dashboard 不一致: ${backupPath}`);
      }
    } else {
      copyFileSync(this.legacyDashboardPath, backupPath);
    }
    chmodSync(backupPath, 0o600);
  }
}
