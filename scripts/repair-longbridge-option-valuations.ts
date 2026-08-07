import { DatabaseSync } from "node:sqlite";
import path from "node:path";

import { isLongbridgeUsOptionSymbol } from "@/server/asset-sources/longbridge";

type JsonObject = Record<string, unknown>;

function optionValueIsMissing(holding: JsonObject): boolean {
  return (
    typeof holding.symbol === "string" &&
    holding.marketValue === null &&
    holding.currentPrice === null &&
    isLongbridgeUsOptionSymbol(holding.symbol)
  );
}

function repairHolding(holding: JsonObject): JsonObject | null {
  const valuation = holding.valuation;
  if (
    !optionValueIsMissing(holding) ||
    typeof valuation !== "object" ||
    valuation === null ||
    (valuation as JsonObject).status !== "unvalued"
  ) {
    return null;
  }
  return {
    ...holding,
    valuation: {
      status: "quote-unavailable",
      reason: "Longbridge Open API 未接入期权行情",
    },
  };
}

function requiredDay(): string {
  const value = process.argv.find((argument) => argument.startsWith("--day="))
    ?.slice("--day=".length);
  if (value === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("请通过 --day=YYYY-MM-DD 指定需要修复的上海自然日");
  }
  return value;
}

const day = requiredDay();
const dryRun = process.argv.includes("--dry-run");
const dataDir = process.env.KANBAN_DATA_DIR?.trim() || path.join(process.cwd(), "data");
const database = new DatabaseSync(path.join(dataDir, "dashboard.sqlite"));

try {
  database.exec("BEGIN IMMEDIATE");
  const sources = database.prepare(`
    SELECT s.id, snapshots.holdings_json
    FROM asset_sources AS s
    JOIN asset_source_snapshots AS snapshots ON snapshots.source_id = s.id
    WHERE s.kind = 'longbridge'
  `).all() as Array<{ id: string; holdings_json: string }>;

  let repairedHoldings = 0;
  const repairedSourceIds = new Set<string>();
  const updateSource = database.prepare(`
    UPDATE asset_source_snapshots
    SET holdings_json = ?
    WHERE source_id = ?
  `);

  for (const source of sources) {
    const holdings = JSON.parse(source.holdings_json) as unknown;
    if (!Array.isArray(holdings)) {
      throw new Error(`长桥来源 ${source.id} 的持仓数据格式无效`);
    }
    const repaired = holdings.map((value) => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`长桥来源 ${source.id} 含无效持仓`);
      }
      const next = repairHolding(value as JsonObject);
      if (next === null) return value;
      repairedHoldings += 1;
      repairedSourceIds.add(source.id);
      return next;
    });
    if (repairedSourceIds.has(source.id) && !dryRun) {
      updateSource.run(JSON.stringify(repaired), source.id);
    }
  }

  let repairedDailySourceRows = 0;
  for (const sourceId of repairedSourceIds) {
    const result = database.prepare(`
      UPDATE daily_asset_source_trend_observations
      SET complete = 1, status = 'complete'
      WHERE day = ? AND source_id = ? AND status = 'incomplete'
    `).run(day, sourceId);
    repairedDailySourceRows += Number(result.changes);
  }

  const dailySourceRows = database.prepare(`
    SELECT complete, status
    FROM daily_asset_source_trend_observations
    WHERE day = ?
  `).all(day) as Array<{ complete: number; status: "complete" | "incomplete" | "expired" }>;
  if (dailySourceRows.length === 0) {
    throw new Error(`${day} 没有每日趋势来源记录，未执行修复`);
  }
  const complete = dailySourceRows.every((row) => row.complete === 1);
  const status = dailySourceRows.some((row) => row.status === "expired")
    ? "expired"
    : complete
      ? "complete"
      : "incomplete";
  const trendResult = database.prepare(`
    UPDATE daily_asset_trend_observations
    SET complete = ?, status = ?
    WHERE day = ?
  `).run(Number(complete), status, day);
  if (trendResult.changes !== 1) {
    throw new Error(`${day} 没有每日趋势总记录，未执行修复`);
  }

  if (dryRun) database.exec("ROLLBACK");
  else database.exec("COMMIT");
  process.stdout.write(`${JSON.stringify({
    dryRun,
    day,
    repairedHoldings,
    repairedDailySourceRows,
    dailyTrend: { complete, status },
  })}\n`);
} catch (error) {
  try {
    database.exec("ROLLBACK");
  } catch {
    // 未开启事务时无需回滚。
  }
  throw error;
} finally {
  database.close();
}
