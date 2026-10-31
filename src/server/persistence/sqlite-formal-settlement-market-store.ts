import type { DatabaseSync } from "node:sqlite";
import type { FormalSettlementMarketObservation, FormalSettlementMarkets } from "@/server/ports";

/** 日结市场发现属于运行状态；来源删除或业务恢复时随来源外键清除。 */
export class SqliteFormalSettlementMarketStore {
  constructor(private readonly database: DatabaseSync) {}

  list(): FormalSettlementMarketObservation[] {
    const rows = this.database.prepare(`
      SELECT evidence.source_id, evidence.account_id, evidence.observed_at, evidence.markets_json
      FROM formal_settlement_markets evidence
      JOIN asset_sources source ON source.id = evidence.source_id
      WHERE source.kind = 'longbridge' AND source.account_id = evidence.account_id
    `).all() as { source_id: string; account_id: string; observed_at: string; markets_json: string }[];
    return rows.map(row => ({
      sourceId: row.source_id,
      accountId: row.account_id,
      observedAt: row.observed_at,
      markets: JSON.parse(row.markets_json) as FormalSettlementMarketObservation["markets"],
    }));
  }

  record(observations: Parameters<FormalSettlementMarkets["record"]>[0]): void {
    const statement = this.database.prepare(`
      INSERT INTO formal_settlement_markets (source_id, account_id, observed_at, markets_json)
      SELECT source.id, source.account_id, ?, ?
      FROM asset_sources source
      JOIN asset_source_snapshots snapshot ON snapshot.source_id = source.id
      WHERE source.id = ? AND source.kind = 'longbridge' AND source.account_id = ?
        AND source.credential_reference IS ? AND source.lifecycle IS NOT 'disconnected'
        AND snapshot.synced_at <= ?
      ON CONFLICT(source_id) DO UPDATE SET
        account_id = excluded.account_id,
        observed_at = excluded.observed_at,
        markets_json = excluded.markets_json
      WHERE excluded.observed_at >= formal_settlement_markets.observed_at
        OR excluded.account_id <> formal_settlement_markets.account_id
    `);
    for (const { source, observedAt, markets } of observations) {
      statement.run(observedAt, JSON.stringify(markets), source.id, source.accountId,
        source.credentialReference, observedAt);
    }
  }
}
