import type { DatabaseSync } from "node:sqlite";
import type { FormalSettlementExecution } from "@/server/ports";

/** 正式日结最近执行记录的 SQLite 读写模块；事务边界由数据库拥有者控制。 */
export class SqliteFormalSettlementExecutionStore {
  constructor(private readonly database: DatabaseSync) {}

  latest(): FormalSettlementExecution | null {
    const row = this.database.prepare(
      "SELECT payload_json FROM formal_settlement_execution WHERE id = 1",
    ).get() as { payload_json: string } | undefined;
    return row ? JSON.parse(row.payload_json) as FormalSettlementExecution : null;
  }

  record(execution: FormalSettlementExecution): void {
    this.database.prepare(
      "INSERT INTO formal_settlement_execution (id, started_at, payload_json) VALUES (1, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET started_at = excluded.started_at, payload_json = excluded.payload_json " +
      "WHERE excluded.started_at >= formal_settlement_execution.started_at",
    ).run(execution.startedAt, JSON.stringify(execution));
  }
}
