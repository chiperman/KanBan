import type { DatabaseSync } from "node:sqlite";
import type { SqliteRow } from "./contracts";

/** SQLite 元数据键值写入模块；事务边界由调用方持有。 */
export class SqliteMetadataStore {
  constructor(private readonly database: DatabaseSync) {}

  get(key: string): string | null {
    const row = this.database
      .prepare("SELECT value FROM schema_metadata WHERE key = ?")
      .get(key) as SqliteRow | undefined;
    return typeof row?.value === "string" ? row.value : null;
  }

  set(key: string, value: string): void {
    this.database
      .prepare("INSERT OR REPLACE INTO schema_metadata (key, value) VALUES (?, ?)")
      .run(key, value);
  }

  setIfAbsent(key: string, value: string): boolean {
    return this.database
      .prepare("INSERT OR IGNORE INTO schema_metadata (key, value) VALUES (?, ?)")
      .run(key, value).changes > 0;
  }

  delete(key: string): void {
    this.database.prepare("DELETE FROM schema_metadata WHERE key = ?").run(key);
  }

  deleteIfValue(key: string, value: string): void {
    this.database
      .prepare("DELETE FROM schema_metadata WHERE key = ? AND value = ?")
      .run(key, value);
  }

  deleteMany(keys: string[]): void {
    if (keys.length === 0) return;
    const placeholders = keys.map(() => "?").join(", ");
    this.database
      .prepare(`DELETE FROM schema_metadata WHERE key IN (${placeholders})`)
      .run(...keys);
  }
}
