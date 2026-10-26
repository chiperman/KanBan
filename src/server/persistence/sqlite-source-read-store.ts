import { normalizeIgnoredAssetKeys, withEffectiveEvmSnapshotCoverage } from "@/domain/evm-token-preferences";
import { normalizeAssetSyncState } from "@/server/asset-sync-diagnostics";
import type { SqliteRow } from "@/server/persistence/contracts";
import { migrateAssetSource } from "@/server/persistence/migrations";
import type { AssetSourceSummary, ManualAssetClass, ManualAssetRecord } from "@/server/ports";
import type { DatabaseSync } from "node:sqlite";

/** SQLite 来源资料与手工记录查询；不承担写入或事务。 */
export class SqliteSourceReadStore {
  constructor(private readonly database: DatabaseSync) {}

  listSourcesSync(detailSourceId?: string): AssetSourceSummary[] {
    const rows = this.database
      .prepare("SELECT * FROM asset_sources ORDER BY position")
      .all() as SqliteRow[];
    // 保留全局汇率与注册元数据，但详情查询不解码无关来源持仓。
    const snapshots = this.database.prepare(detailSourceId === undefined
      ? "SELECT * FROM asset_source_snapshots"
      : "SELECT source_id, total_amount, total_currency, synced_at, exchange_rates_json, longbridge_valuation_json, CASE WHEN source_id = ? THEN holdings_json ELSE '[]' END AS holdings_json, CASE WHEN source_id = ? THEN unrecognized_evm_tokens_json ELSE '[]' END AS unrecognized_evm_tokens_json, CASE WHEN source_id = ? THEN coverage_json ELSE NULL END AS coverage_json FROM asset_source_snapshots")
      .all(...(detailSourceId === undefined ? [] : [detailSourceId, detailSourceId, detailSourceId])) as SqliteRow[];
    const snapshotMap = new Map(snapshots.map((row) => [row.source_id, row]));
    const syncMap = new Map((this.database.prepare("SELECT * FROM asset_source_sync_states").all() as SqliteRow[]).map((row) => [row.source_id, row]));
    return rows.map((row) => {
      const snapshot = snapshotMap.get(row.id)!;
      const sync = syncMap.get(row.id)!;
      const unrecognizedEvmTokens = JSON.parse(
        (snapshot.unrecognized_evm_tokens_json as string | null) ?? "[]",
      );
      return withEffectiveEvmSnapshotCoverage(migrateAssetSource({
        id: row.id as string,
        kind: row.kind as string,
        investmentBookId: row.investment_book_id ?? null,
        label: row.label as string,
        ...(typeof row.display_name === "string"
          ? { displayName: row.display_name }
          : {}),
        accountId: row.account_id as string,
        permissions: JSON.parse(row.permissions_json as string),
        credentialReference:
          typeof row.credential_reference === "string"
            ? row.credential_reference
            : null,
        ignoredAssetKeys: normalizeIgnoredAssetKeys(
          JSON.parse(
            (row.ignored_asset_keys_json as string | null) ?? "[]",
          ),
        ),
        includedAssetKeys: normalizeIgnoredAssetKeys(
          JSON.parse(
            (row.included_asset_keys_json as string | null) ?? "[]",
          ),
        ),
        ...(row.kind === "manual"
          ? {
              hasManualRecord: row.has_manual_record !== 0,
              ...(typeof row.manual_asset_class === "string"
                ? {
                    manualAssetClass:
                      row.manual_asset_class as ManualAssetClass,
                  }
                : {}),
            }
          : {}),
        snapshot: {
          total: {
            amount: snapshot.total_amount as string,
            currency: snapshot.total_currency as string,
          },
          ...(snapshot.longbridge_valuation_json == null
            ? {}
            : { longbridgeValuation: JSON.parse(snapshot.longbridge_valuation_json as string) }),
          holdings: JSON.parse(snapshot.holdings_json as string),
          ...(unrecognizedEvmTokens.length === 0
            ? {}
            : { unrecognizedEvmTokens }),
          exchangeRates: JSON.parse(snapshot.exchange_rates_json as string),
          ...(snapshot.coverage_json === null
            ? {}
            : {
                coverage: JSON.parse(snapshot.coverage_json as string),
              }),
          syncedAt: snapshot.synced_at as string,
        },
        sync: normalizeAssetSyncState({
          status: sync.status as "current" | "expired",
          lastSuccessfulAt: sync.last_successful_at as string,
          lastAttemptAt: sync.last_attempt_at as string,
          error: sync.error as string | null,
          ...(sync.failed_mode === null
            ? {}
            : { failedMode: sync.failed_mode as "all" | "prices" | "holdings" }),
          ...(sync.diagnostic_json === null
            ? {}
            : { diagnostic: JSON.parse(sync.diagnostic_json as string) }),
          ...(sync.recent_attempts_json === "[]" ? {} : {
            recentAttempts: JSON.parse((sync.recent_attempts_json as string | null) ?? "[]"),
          }),
        }),
        ...(row.lifecycle === null
          ? {}
          : { lifecycle: row.lifecycle as "connected" | "disconnected" }),
      }));
    });
  }

  listManualAssetRecordsSync(sourceId?: string): ManualAssetRecord[] {
    const rows = this.database
      .prepare(`
        SELECT source_id, day, amount, currency, recorded_at
        FROM manual_asset_records
        ${sourceId === undefined ? "" : "WHERE source_id = ?"}
        ORDER BY source_id, day DESC
      `)
      .all(...(sourceId === undefined ? [] : [sourceId])) as SqliteRow[];
    return rows.map((row) => ({
      sourceId: row.source_id as string,
      day: row.day as string,
      amount: row.amount as string,
      currency: row.currency as ManualAssetRecord["currency"],
      recordedAt: row.recorded_at as string,
    }));
  }
}
