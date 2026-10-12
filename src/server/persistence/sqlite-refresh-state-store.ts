import type { DatabaseSync } from "node:sqlite";
import type { SqliteRow } from "@/server/persistence/contracts";

export interface SqliteAssetFullRefreshState {
  attemptedAt: string | null;
  inProgressAt: string | null;
}

/** 全量刷新租约与 SQLite 元数据共用的轻量写入模块；事务边界由调用方持有。 */
export class SqliteRefreshStateStore {
  constructor(private readonly database: DatabaseSync) {}

  metadata(key: string): string | null {
    const row = this.database
      .prepare("SELECT value FROM schema_metadata WHERE key = ?")
      .get(key) as SqliteRow | undefined;
    return typeof row?.value === "string" ? row.value : null;
  }

  read(): SqliteAssetFullRefreshState {
    return {
      attemptedAt: this.metadata("asset_full_refresh_attempted_at"),
      inProgressAt: this.metadata("asset_full_refresh_in_progress_at"),
    };
  }

  start(attemptedAt: string): void {
    const write = this.database.prepare(
      "INSERT OR REPLACE INTO schema_metadata (key, value) VALUES (?, ?)",
    );
    write.run("asset_full_refresh_attempted_at", attemptedAt);
    write.run("asset_full_refresh_in_progress_at", attemptedAt);
  }

  initialize(attemptedAt: string): boolean {
    return this.database
      .prepare(
        "INSERT OR IGNORE INTO schema_metadata (key, value) VALUES (?, ?)",
      )
      .run("asset_full_refresh_attempted_at", attemptedAt).changes > 0;
  }

  claim(input: {
    attemptedAt: string;
    intervalMs: number;
    staleAfterMs: number;
    force: boolean;
  }): "claimed" | "not-due" | "in-progress" {
    const previousAttemptedAt = this.metadata(
      "asset_full_refresh_attempted_at",
    );
    const inProgressAt = this.metadata("asset_full_refresh_in_progress_at");
    const now = Date.parse(input.attemptedAt);
    const inProgress = inProgressAt === null
      ? Number.NaN
      : Date.parse(inProgressAt);
    const inProgressIsCurrent =
      Number.isFinite(inProgress) &&
      Number.isFinite(now) &&
      now - inProgress < input.staleAfterMs;
    if (inProgressAt !== null && inProgressIsCurrent) return "in-progress";

    const previous = previousAttemptedAt === null
      ? Number.NaN
      : Date.parse(previousAttemptedAt);
    if (
      !input.force &&
      Number.isFinite(previous) &&
      Number.isFinite(now) &&
      now - previous < input.intervalMs
    ) {
      return "not-due";
    }

    this.start(input.attemptedAt);
    return "claimed";
  }

  finish(attemptedAt?: string): void {
    if (attemptedAt === undefined) {
      this.database
        .prepare("DELETE FROM schema_metadata WHERE key = ?")
        .run("asset_full_refresh_in_progress_at");
      return;
    }
    this.database
      .prepare("DELETE FROM schema_metadata WHERE key = ? AND value = ?")
      .run("asset_full_refresh_in_progress_at", attemptedAt);
  }

  clear(): void {
    this.database
      .prepare("DELETE FROM schema_metadata WHERE key IN (?, ?)")
      .run(
        "asset_full_refresh_attempted_at",
        "asset_full_refresh_in_progress_at",
      );
  }
}
