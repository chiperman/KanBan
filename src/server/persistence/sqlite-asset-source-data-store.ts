import type { DatabaseSync } from "node:sqlite";
import { normalizeAssetSyncState } from "@/server/asset-sync-diagnostics";
import { isPersistedAssetSourceKind } from "@/domain/asset-source-kinds";
import { normalizedSourceBookId, sourceInvestmentBookId } from "@/domain/source-investment-book";
import { assertPluginSnapshot } from "@/server/asset-source-plugins/snapshot-validation";
import type { SqliteRow } from "./contracts";
import type { AssetSourceSummary, ManualAssetClass } from "@/server/ports";

/** 来源资料、快照与同步诊断写入模块；事务边界由调用方持有。 */
export class SqliteAssetSourceDataStore {
  constructor(private readonly database: DatabaseSync) {}

  insert(source: AssetSourceSummary, position: number): void {
    if (!isPersistedAssetSourceKind(source.kind)) throw new Error("资产来源类型无效");
    if (source.kind.startsWith("plugin:")) assertPluginSnapshot(source.snapshot);
    const bookId = normalizedSourceBookId(source);
    this.database
      .prepare(`
        INSERT INTO asset_sources (
          id, position, kind, label, display_name, account_id, permissions_json,
          credential_reference, ignored_asset_keys_json, included_asset_keys_json,
          has_manual_record, manual_asset_class, lifecycle, investment_book_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        source.id,
        position,
        source.kind,
        source.label,
        source.displayName ?? null,
        source.accountId,
        JSON.stringify(source.permissions),
        source.credentialReference,
        JSON.stringify(source.ignoredAssetKeys ?? []),
        JSON.stringify(source.includedAssetKeys ?? []),
        source.kind === "manual" && source.hasManualRecord === false ? 0 : 1,
        source.kind === "manual" ? source.manualAssetClass ?? null : null,
        source.lifecycle ?? null,
        bookId,
      );
    this.writeDetails(source);
  }

  update(source: AssetSourceSummary): void {
    if (!isPersistedAssetSourceKind(source.kind)) throw new Error("资产来源类型无效");
    if (source.kind.startsWith("plugin:")) assertPluginSnapshot(source.snapshot);
    const bookId = normalizedSourceBookId(source);
    const existing = this.database
      .prepare("SELECT id FROM asset_sources WHERE id = ?")
      .get(source.id);
    if (existing === undefined) return;
    this.database
      .prepare(`
        UPDATE asset_sources
        SET kind = ?, label = ?, display_name = ?, account_id = ?,
            permissions_json = ?, credential_reference = ?,
            ignored_asset_keys_json = ?, included_asset_keys_json = ?,
            manual_asset_class = ?, lifecycle = ?, investment_book_id = ?
        WHERE id = ?
      `)
      .run(
        source.kind,
        source.label,
        source.displayName ?? null,
        source.accountId,
        JSON.stringify(source.permissions),
        source.credentialReference,
        JSON.stringify(source.ignoredAssetKeys ?? []),
        JSON.stringify(source.includedAssetKeys ?? []),
        source.kind === "manual" ? source.manualAssetClass ?? null : null,
        source.lifecycle ?? null,
        bookId,
        source.id,
      );
    this.writeDetails(source);
  }

  writeDetails(source: AssetSourceSummary): void {
    const sync = normalizeAssetSyncState(source.sync);
    this.database
      .prepare(`
        UPDATE asset_sources
        SET has_manual_record = ?
        WHERE id = ?
      `)
      .run(
        source.kind === "manual" && source.hasManualRecord === false ? 0 : 1,
        source.id,
      );
    this.database
      .prepare(`
        INSERT OR REPLACE INTO asset_source_snapshots (
          source_id, total_amount, total_currency, holdings_json,
          unrecognized_evm_tokens_json, exchange_rates_json, coverage_json,
          longbridge_valuation_json, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        source.id,
        source.snapshot.total.amount,
        source.snapshot.total.currency,
        JSON.stringify(source.snapshot.holdings),
        JSON.stringify(source.snapshot.unrecognizedEvmTokens ?? []),
        JSON.stringify(source.snapshot.exchangeRates),
        source.snapshot.coverage === undefined
          ? null
          : JSON.stringify(source.snapshot.coverage),
        source.snapshot.longbridgeValuation === undefined
          ? null
          : JSON.stringify(source.snapshot.longbridgeValuation),
        source.snapshot.syncedAt,
      );
    this.database
      .prepare(`
        INSERT OR REPLACE INTO asset_source_sync_states (
          source_id, status, last_successful_at, last_attempt_at, error, failed_mode,
          diagnostic_json, recent_attempts_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        source.id,
        source.sync.status,
        source.sync.lastSuccessfulAt,
        source.sync.lastAttemptAt,
        source.sync.error,
        source.sync.failedMode ?? null,
        sync.diagnostic === undefined || sync.diagnostic === null
          ? null : JSON.stringify(sync.diagnostic),
        JSON.stringify(sync.recentAttempts ?? []),
      );
  }

  setDisplayName(sourceId: string, displayName: string | null): void {
    const result = this.database
      .prepare("UPDATE asset_sources SET display_name = ? WHERE id = ?")
      .run(displayName, sourceId);
    if (result.changes === 0) throw new Error("资产来源不存在");
  }

  setManualClass(sourceId: string, assetClass: ManualAssetClass | null): void {
    const source = this.database
      .prepare("SELECT kind FROM asset_sources WHERE id = ?")
      .get(sourceId) as { kind: string } | undefined;
    if (!source) throw new Error("资产来源不存在");
    if (source.kind !== "manual") {
      throw new Error("只有手工资产来源可以设置资产类别");
    }
    this.database
      .prepare("UPDATE asset_sources SET manual_asset_class = ?, investment_book_id = ? WHERE id = ?")
      .run(assetClass, sourceInvestmentBookId({ kind: "manual", manualAssetClass: assetClass ?? undefined }), sourceId);
  }

  setEvmTokenPreferences(
    sourceId: string,
    ignoredAssetKeys: string[],
    includedAssetKeys: string[],
  ): void {
    const result = this.database
      .prepare(`
        UPDATE asset_sources
        SET ignored_asset_keys_json = ?, included_asset_keys_json = ?
        WHERE id = ?
      `)
      .run(
        JSON.stringify(ignoredAssetKeys),
        JSON.stringify(includedAssetKeys),
        sourceId,
      );
    if (result.changes === 0) throw new Error("资产来源不存在");
  }

  count(): number {
    return (this.database
      .prepare("SELECT COUNT(*) AS count FROM asset_sources")
      .get() as SqliteRow).count as number;
  }
}
