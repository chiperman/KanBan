import type { SqliteMetadataStore } from "./sqlite-metadata-store";

export interface SqliteAssetFullRefreshState {
  attemptedAt: string | null;
  inProgressAt: string | null;
}

/** 全量刷新租约与 SQLite 元数据共用的轻量写入模块；事务边界由调用方持有。 */
export class SqliteRefreshStateStore {
  constructor(private readonly metadataStore: SqliteMetadataStore) {}

  metadata(key: string): string | null {
    return this.metadataStore.get(key);
  }

  read(): SqliteAssetFullRefreshState {
    return {
      attemptedAt: this.metadata("asset_full_refresh_attempted_at"),
      inProgressAt: this.metadata("asset_full_refresh_in_progress_at"),
    };
  }

  start(attemptedAt: string): void {
    this.metadataStore.set("asset_full_refresh_attempted_at", attemptedAt);
    this.metadataStore.set("asset_full_refresh_in_progress_at", attemptedAt);
  }

  initialize(attemptedAt: string): boolean {
    return this.metadataStore.setIfAbsent(
      "asset_full_refresh_attempted_at",
      attemptedAt,
    );
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
      this.metadataStore.delete("asset_full_refresh_in_progress_at");
      return;
    }
    this.metadataStore.deleteIfValue(
      "asset_full_refresh_in_progress_at",
      attemptedAt,
    );
  }

  clear(): void {
    this.metadataStore.deleteMany([
      "asset_full_refresh_attempted_at",
      "asset_full_refresh_in_progress_at",
    ]);
  }
}
