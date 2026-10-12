import type { DatabaseSync } from "node:sqlite";
import { DashboardSchema } from "./sqlite-schema";
import type { SqliteMetadataStore } from "./sqlite-metadata-store";

type Transaction = <T>(operation: () => T) => T;

/** SQLite 建表与 Schema 迁移模块；旧 JSON 由独立迁移入口处理。 */
export class SqliteDatabaseInitializationStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly transaction: Transaction,
    private readonly metadataStore: SqliteMetadataStore,
  ) {}

  initialize(): void {
    new DashboardSchema(
      this.database,
      this.transaction,
      (key) => this.metadataStore.get(key),
    ).createSchema();
  }
}
