import { shanghaiDay } from "@/domain/daily-asset-snapshots";
import type { BookRecord } from "@/domain/investment-books";
import { dailyAssetAmount, dailyAssetQuery, dailyAssetRecordId, type LongbridgeDailyAsset, type LongbridgeDailyAssetsConfig } from "@/server/asset-sources/longbridge-daily-assets";
import { sameAccount } from "@/server/asset-sources/longbridge-connection";
import type { SqliteDashboardComposition } from "./sqlite-database-composition";

const key = (sourceId: string) => `longbridge_daily_assets:${sourceId}`;
const leaseKey = "longbridge_daily_assets_lease";

function correctedAssetDays(records: BookRecord[], sourceId: string): Set<string> {
  const replacedIds = new Set(records.flatMap(row => row.replacesId ? [row.replacesId] : []));
  return new Set(records.filter(row => row.bookId === "us-stocks" && row.kind === "valuation" &&
    (row.replacesId || replacedIds.has(row.id) ||
      (row.origin === "provider" && row.voidedAt && row.id === dailyAssetRecordId(sourceId, row.day))))
    .map(row => row.day));
}

/** 调用方持有共享 SQLite 事务；只替换资产，资金事实和其他来源不变。 */
export class SqliteLongbridgeDailyAssets {
  constructor(private readonly stores: SqliteDashboardComposition) {}

  list(now: string) {
    const { readModel, metadata, database } = this.stores;
    const state = this.stores.investmentBooks.stored();
    const today = shanghaiDay(now);
    return readModel.listSourcesSync().flatMap(source => {
      const value = metadata.get(key(source.id));
      if (!value || source.kind !== "longbridge" || source.lifecycle === "disconnected" || !source.credentialReference) return [];
      const config = JSON.parse(value) as LongbridgeDailyAssetsConfig;
      if (source.id !== config.sourceId || source.accountId !== config.accountId || source.credentialReference !== config.credentialReference) return [];
      dailyAssetQuery(config.fromDay);
      const providerRecords = new Map(state?.records.filter(row => row.bookId === "us-stocks" && row.origin === "provider" &&
        row.kind === "valuation" && row.id === dailyAssetRecordId(source.id, row.day)).map(row => [row.day, row]));
      const correctedDays = correctedAssetDays(state?.records ?? [], source.id);
      const imported = new Map((database.prepare("SELECT day, total_usd FROM imported_asset_source_history_observations WHERE source_id = ?").all(source.id) as Array<{ day: string; total_usd: string | null }>).map(row => [row.day, row.total_usd]));
      const days: string[] = [];
      for (let time = Date.parse(config.fromDay); time < Date.parse(today); time += 86_400_000) {
        const day = new Date(time).toISOString().slice(0, 10);
        const record = providerRecords.get(day);
        // 更正或作废保留的原件仍证明已补取，不能因此重新导入并复活旧金额。
        if (imported.get(day) == null || (!correctedDays.has(day) && (!record || imported.get(day) !== record.amount))) days.push(day);
      }
      return [{ config, source, days }];
    });
  }

  claim(token: string, now: string) { return this.stores.refreshState.claimLease(leaseKey, token, now, 60_000); }
  release(token: string) { this.stores.refreshState.releaseLease(leaseKey, token); }

  save(config: LongbridgeDailyAssetsConfig, rows: LongbridgeDailyAsset[], now: string, token?: string) {
    const { database, readModel, investmentBooks, metadata, observations } = this.stores;
    if (token && !this.stores.refreshState.ownsLease(leaseKey, token, now)) throw new Error("长桥历史补取租约已失效");
    const source = readModel.listSourcesSync().find(source => source.id === config.sourceId);
    if (!source || source.kind !== "longbridge" || source.lifecycle === "disconnected" ||
        source.accountId !== config.accountId || source.credentialReference !== config.credentialReference) throw new Error("长桥历史目标来源已改变");
    dailyAssetQuery(config.fromDay);
    const previous = metadata.get(key(config.sourceId));
    if (previous) {
      const existing = JSON.parse(previous) as LongbridgeDailyAssetsConfig;
      sameAccount(existing.account, config.account);
      if (existing.fromDay !== config.fromDay || existing.credentialReference !== config.credentialReference || existing.accountId !== config.accountId) throw new Error("长桥历史配置已改变");
    }
    const state = investmentBooks.read();
    const roster = state.members.filter(member => member.bookId === "us-stocks");
    const days = new Set(rows.map(row => row.day));
    if (days.size !== rows.length) throw new Error("长桥每日资产日期重复");
    for (const row of rows) {
      sameAccount(config.account, row.account);
      dailyAssetAmount(row, now);
      const members = roster.filter(member => (member.fromDay === null || member.fromDay <= row.day) && (member.toDay === null || row.day < member.toDay));
      if (row.sourceId !== source.id || row.day < config.fromDay || members.length !== 1 ||
          members[0].sourceId !== source.id || !members[0].confirmed) throw new Error("长桥每日资产与账本来源范围不匹配");
    }
    if (state.records.some(row => row.bookId === "us-stocks" && row.kind === "valuation" && days.has(row.day) && row.origin === "import")) throw new Error("需要先核对已有导入资产原件");
    // 补取在途时也可能发生更正；写入时复核原件，保留其作废状态及更正链。
    const correctedDays = correctedAssetDays(state.records, source.id);
    const replaceDays = new Set([...days].filter(day => !correctedDays.has(day)));
    const removed = state.records.filter(row => row.bookId === "us-stocks" && row.kind === "valuation" && replaceDays.has(row.day)).length;
    state.records = state.records.filter(row => !(row.bookId === "us-stocks" && row.kind === "valuation" && replaceDays.has(row.day)));
    for (const row of rows) {
      const amount = dailyAssetAmount(row, now);
      const id = dailyAssetRecordId(source.id, row.day);
      if (replaceDays.has(row.day)) {
        state.records.push({ id, originKey: id, bookId: "us-stocks", kind: "valuation", day: row.day, amount,
          currency: "USD", origin: "provider", recordedAt: row.fetchedAt, note: "长桥每日资产 · 上海自然日 · ending_asset_value" });
      }
      const capturedAt = new Date(Number(row.query.end) * 1000).toISOString();
      database.prepare("DELETE FROM source_investment_records WHERE source_id = ? AND day = ? AND kind = 'valuation'").run(source.id, row.day);
      database.prepare(`INSERT INTO imported_asset_source_history_observations
        (source_id, day, label, kind, captured_at, complete, status, total_usd, total_cny, total_hkd)
        VALUES (?, ?, ?, 'longbridge', ?, 1, 'complete', ?, NULL, NULL)
        ON CONFLICT(source_id, day) DO UPDATE SET label=excluded.label, kind=excluded.kind,
          captured_at=excluded.captured_at, complete=1, status='complete', total_usd=excluded.total_usd, total_cny=NULL, total_hkd=NULL`)
        .run(source.id, row.day, source.label, capturedAt, amount);
      // 仅校正已有组合观测中的长桥分量，不为缺少其他来源的历史创建组合日记录。
      for (const tables of [
        { source: "daily_asset_source_snapshots", snapshot: "daily_asset_snapshots" },
        { source: "daily_asset_source_trend_observations", snapshot: "daily_asset_trend_observations" },
      ] as const) {
        const updated = database.prepare(`UPDATE ${tables.source} SET captured_at=?, total_usd=?, total_cny=NULL,
          total_hkd=NULL, complete=0, status='incomplete', asset_class_totals_json=NULL WHERE source_id=? AND day=?`)
          .run(capturedAt, amount, source.id, row.day);
        if (updated.changes) observations.recalculate(row.day, tables);
      }
    }
    if (rows.length) investmentBooks.write(state);
    metadata.set(key(source.id), JSON.stringify({ ...config,
      lastSuccessDay: [previous ? (JSON.parse(previous) as LongbridgeDailyAssetsConfig).lastSuccessDay ?? "" : "", ...rows.map(row => row.day)].sort().at(-1) || undefined }));
    return { days: rows.length, removedValuations: removed };
  }
}
