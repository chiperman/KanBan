import { parseSourceInvestmentHistory, type SourceInvestmentHistory } from "@/domain/source-investment-history";
import { normalizeIgnoredAssetKeys, withEffectiveEvmSnapshotCoverage } from "@/domain/evm-token-preferences";
import { normalizeAssetSyncState } from "@/server/asset-sync-diagnostics";
import type { InvestmentCashflow } from "@/server/ports";
import type { SqliteRow } from "@/server/persistence/contracts";
import { migrateAssetSource, migrateDailyObservation } from "@/server/persistence/migrations";
import type { AssetSourceSummary, DailyAssetSnapshot, DailyAssetTrendObservation, ImportedAssetSourceHistoryObservation, ManualAssetClass, ManualAssetRecord } from "@/server/ports";
import type { SourceInvestmentRecord } from "@/domain/source-investment-records";
import type { DatabaseSync } from "node:sqlite";

type DailyObservationTable =
  | "daily_asset_snapshots"
  | "daily_asset_trend_observations";
type DailySourceTable =
  | "daily_asset_source_snapshots"
  | "daily_asset_source_trend_observations";

/** SQLite 查询与行解码模块；写入事务仍由拥有连接的适配器控制。 */
export class SqliteDashboardReadModel {
  constructor(private readonly database: DatabaseSync) {}

  dailySourceRows(
    day: string,
    table: DailySourceTable = "daily_asset_source_snapshots",
  ): SqliteRow[] {
    return this.database
      .prepare(`
        SELECT source_id, label, kind, captured_at, complete, status, total_usd, total_cny,
          total_hkd, asset_class_totals_json
        FROM ${table}
        WHERE day = ?
        ORDER BY rowid
      `)
      .all(day) as SqliteRow[];
  }

  listSourcesSync(detailSourceId?: string): AssetSourceSummary[] {
    const rows = this.database
      .prepare("SELECT * FROM asset_sources ORDER BY position")
      .all() as SqliteRow[];
    // Retain global rates/registration metadata without decoding unrelated holdings.
    const snapshots = this.database.prepare(detailSourceId === undefined
      ? "SELECT * FROM asset_source_snapshots"
      : "SELECT source_id, total_amount, total_currency, synced_at, exchange_rates_json, CASE WHEN source_id = ? THEN holdings_json ELSE '[]' END AS holdings_json, CASE WHEN source_id = ? THEN unrecognized_evm_tokens_json ELSE '[]' END AS unrecognized_evm_tokens_json, CASE WHEN source_id = ? THEN coverage_json ELSE NULL END AS coverage_json FROM asset_source_snapshots")
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

  listInvestmentCashflowsSync(): InvestmentCashflow[] {
    const rows = this.database
      .prepare(`
        SELECT * FROM investment_cashflows
        ORDER BY occurred_at DESC, created_at DESC, id DESC
      `)
      .all() as SqliteRow[];
    return rows.map((row) => ({
      id: row.id as string,
      kind: row.kind as InvestmentCashflow["kind"],
      occurredAt: row.occurred_at as string,
      amount: row.amount as string,
      currency: row.currency as InvestmentCashflow["currency"],
      note: row.note as string | null,
      amounts: {
        USD: row.amount_usd as string | null,
        CNY: row.amount_cny as string | null,
        HKD: row.amount_hkd as string | null,
      },
      exchangeRates: JSON.parse(row.exchange_rates_json as string),
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));
  }

  listDailyAssetSnapshotsSync(): DailyAssetSnapshot[] {
    return this.listDailyObservationsSync(
      "daily_asset_snapshots",
      "daily_asset_source_snapshots",
    );
  }

  listDailyAssetTrendObservationsSync(): DailyAssetTrendObservation[] {
    return this.listDailyObservationsSync(
      "daily_asset_trend_observations",
      "daily_asset_source_trend_observations",
    );
  }

  listImportedSourceHistoryObservationsSync(): ImportedAssetSourceHistoryObservation[] {
    const rows = this.database
      .prepare(`
        SELECT * FROM imported_asset_source_history_observations
        ORDER BY day, source_id
      `)
      .all() as SqliteRow[];
    return rows.map((row) => ({
      day: row.day as string,
      sourceId: row.source_id as string,
      label: row.label as string,
      kind: row.kind as string,
      capturedAt: row.captured_at as string,
      complete: row.complete === 1,
      status: row.status as ImportedAssetSourceHistoryObservation["status"],
      total: {
        USD: row.total_usd as string | null,
        CNY: row.total_cny as string | null,
        HKD: row.total_hkd as string | null,
      },
    }));
  }

  listDailyObservationsSync(
    snapshotTable: DailyObservationTable,
    sourceTable: DailySourceTable,
    day?: string,
    query?: { sourceId: string; from?: string; to?: string },
  ): DailyAssetSnapshot[] {
    const conditions: string[] = [];
    const args: string[] = [];
    if (day !== undefined) { conditions.push("day = ?"); args.push(day); }
    if (query?.from) { conditions.push("day >= ?"); args.push(query.from); }
    if (query?.to) { conditions.push("day <= ?"); args.push(query.to); }
    const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";
    const rows = this.database.prepare("SELECT * FROM " + snapshotTable + where + " ORDER BY day").all(...args) as SqliteRow[];
    const sourceWhere = query ? (where ? where + " AND " : " WHERE ") + "source_id = ?" : where;
    const children = this.database.prepare("SELECT * FROM " + sourceTable + sourceWhere + " ORDER BY day, source_id")
      .all(...args, ...(query ? [query.sourceId] : [])) as SqliteRow[];
    const byDay = new Map<string, SqliteRow[]>();
    for (const child of children) {
      const items = byDay.get(child.day as string) ?? [];
      items.push(child); byDay.set(child.day as string, items);
    }
    return rows.map((row) => migrateDailyObservation({
      day: row.day as string,
      capturedAt: row.captured_at as string,
      complete: row.complete === 1,
      status: row.status as "complete" | "incomplete" | "expired",
      total: {
        USD: row.total_usd as string | null,
        CNY: row.total_cny as string | null,
        HKD: row.total_hkd as string | null,
      },
      exchangeRates: JSON.parse(
        (row.exchange_rates_json as string | null) ?? "[]",
      ),
      sources: (byDay.get(row.day as string) ?? []).map((source) => ({
        sourceId: source.source_id as string,
        label: source.label as string,
        kind: source.kind as string,
        capturedAt: source.captured_at as string,
        complete: source.complete === 1,
        status: source.status as "complete" | "incomplete" | "expired",
        total: {
          USD: source.total_usd as string | null,
          CNY: source.total_cny as string | null,
          HKD: source.total_hkd as string | null,
        },
        ...(source.asset_class_totals_json === null
          ? {}
          : {
              assetClassTotals: JSON.parse(
                source.asset_class_totals_json as string,
              ),
            }),
      })),
    }));
  }

  readSourceDetail(query: { sourceId: string; from?: string; to?: string }) {
    const first = this.database.prepare("SELECT MIN(day) AS day FROM daily_asset_source_trend_observations WHERE source_id = ?").get(query.sourceId) as SqliteRow;
    const row = this.database.prepare("SELECT payload_json FROM asset_source_investment_histories WHERE source_id = ?").get(query.sourceId) as { payload_json: string } | undefined;
    const investmentHistory = row ? parseSourceInvestmentHistory(JSON.parse(row.payload_json)) : null;
    return {
      sources: this.listSourcesSync(query.sourceId),
      manualRecords: this.listManualAssetRecordsSync(query.sourceId),
      history: this.listDailyObservationsSync("daily_asset_trend_observations", "daily_asset_source_trend_observations", undefined, query),
      firstDay: [typeof first.day === "string" ? first.day : undefined, investmentHistory?.openingInvestment.day, this.listSourceInvestmentRecordsSync(query.sourceId)[0]?.day].filter((day): day is string => day !== undefined).sort()[0],
      investmentHistory,
      investmentRecords: this.listSourceInvestmentRecordsSync(query.sourceId),
    };
  }

  listSourceInvestmentRecordsSync(sourceId?: string): SourceInvestmentRecord[] {
    const rows = this.database.prepare("SELECT id, source_id, day, kind, amount, currency, recorded_at FROM source_investment_records " +
      (sourceId === undefined ? "" : "WHERE source_id = ? ") + "ORDER BY source_id, day, id")
      .all(...(sourceId === undefined ? [] : [sourceId])) as SqliteRow[];
    return rows.map(row => ({ id: row.id as string, sourceId: row.source_id as string,
      day: row.day as string, kind: row.kind as SourceInvestmentRecord["kind"],
      amount: row.amount as string, currency: row.currency as SourceInvestmentRecord["currency"],
      recordedAt: row.recorded_at as string }));
  }

  listSourceInvestmentHistories(): SourceInvestmentHistory[] {
    return (this.database.prepare("SELECT payload_json FROM asset_source_investment_histories ORDER BY source_id").all() as { payload_json: string }[])
      .map(row => parseSourceInvestmentHistory(JSON.parse(row.payload_json)));
  }
}
