import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { shanghaiDay } from "@/domain/daily-asset-snapshots";
import type { AssetSourceSummary, Clock } from "@/server/ports";
import { type LongbridgeAccountIdentity } from "./longbridge-keychain-sdk";

import { LONG_BRIDGE_DAILY_PATH, dailyAssetQuery } from "../../../plugins/sdk/longbridge-daily-query";
export { LONG_BRIDGE_DAILY_PATH, dailyAssetQuery } from "../../../plugins/sdk/longbridge-daily-query";
export const dailyAssetRecordId = (sourceId: string, day: string) => `longbridge-daily:${sourceId}:${day}`;

export interface LongbridgeDailyAssetsConfig {
  sourceId: string;
  accountId: string | null;
  credentialReference: string;
  account: LongbridgeAccountIdentity;
  fromDay: string;
  nextAttemptAt?: string;
  lastSuccessDay?: string;
  error?: "daily-assets-unavailable" | null;
}
export interface LongbridgeDailyAsset {
  day: string;
  sourceId: string;
  account: LongbridgeAccountIdentity;
  timeZone: "Asia/Shanghai";
  path: typeof LONG_BRIDGE_DAILY_PATH;
  query: { start: string; end: string };
  fetchedAt: string;
  response: unknown;
}
export interface LongbridgeDailyAssetsStore {
  listLongbridgeDailyAssets(now: string): Promise<Array<{ config: LongbridgeDailyAssetsConfig; source: AssetSourceSummary; days: string[] }>>;
  claimLongbridgeDailyAssets(token: string, now: string): Promise<boolean>;
  releaseLongbridgeDailyAssets(token: string): Promise<void>;
  saveLongbridgeDailyAssets(config: LongbridgeDailyAssetsConfig, rows: LongbridgeDailyAsset[], now: string, token?: string): Promise<unknown>;
}


/** 不导入 invest_amount 或收益字段，也不从美元金额反推历史汇率。 */
export function dailyAssetAmount(row: LongbridgeDailyAsset, now: string): string {
  const query = dailyAssetQuery(row.day);
  const data = row.response as Record<string, unknown> | null;
  if (row.day >= shanghaiDay(now) || row.timeZone !== "Asia/Shanghai" || row.path !== LONG_BRIDGE_DAILY_PATH ||
      row.query.start !== query.start || row.query.end !== query.end || !Number.isFinite(Date.parse(row.fetchedAt)) ||
      !data || data.currency !== "USD" || data.end_date !== row.day || data.end_time !== query.end ||
      typeof data.trade_update_date !== "string" || data.trade_update_date < row.day ||
      typeof data.ending_asset_value !== "string" || !/^-?\d+(\.\d+)?$/.test(data.ending_asset_value)) {
    throw new Error("长桥每日资产尚未更新或响应不匹配");
  }
  return data.ending_asset_value;
}

/** 原始新接口证据按账户保存；重试替换同日文件，不创建旧记录副本。 */
export async function archiveDailyAsset(dataDir: string, row: LongbridgeDailyAsset): Promise<void> {
  if (!/^[a-zA-Z0-9_-]+$/.test(row.account.accountChannel) || !/^\d+$/.test(row.account.memberId)) throw new Error("长桥账户身份无效");
  dailyAssetQuery(row.day);
  const directory = path.join(dataDir, "provider-history", "longbridge", `${row.account.accountChannel}-${row.account.memberId}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${row.day}.json`);
  const pending = `${file}.${randomUUID()}.tmp`;
  await writeFile(pending, JSON.stringify(row, null, 2) + "\n", { mode: 0o600 });
  await rename(pending, file);
}

/** 仅处理显式启用的来源；共用网页刷新和后台入口，每轮最多补七个已结束自然日。 */
export class LongbridgeDailyAssets {
  private running: Promise<void> | null = null;
  constructor(private readonly store: LongbridgeDailyAssetsStore, private readonly dataDir: string, private readonly clock: Clock,
    private readonly readDailyAsset: (source: AssetSourceSummary, account: LongbridgeAccountIdentity, day: string, signal: AbortSignal) => Promise<unknown>) {}

  run(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.collect().catch(() => {
      console.warn("长桥每日资产补取暂不可用，实时资产刷新结果保持有效。");
    }).finally(() => { this.running = null; });
    return this.running;
  }

  private async collect(): Promise<void> {
    const plans = await this.store.listLongbridgeDailyAssets(this.clock.now().toISOString());
    if (!plans.length) return;
    const token = randomUUID();
    if (!await this.store.claimLongbridgeDailyAssets(token, this.clock.now().toISOString())) return;
    const signal = AbortSignal.timeout(45_000);
    try {
      for (const { config, source, days } of await this.store.listLongbridgeDailyAssets(this.clock.now().toISOString())) {
        if (signal.aborted) break;
        const now = this.clock.now().toISOString();
        if (!days.length || (config.nextAttemptAt && config.nextAttemptAt > now)) continue;
        try {
          for (const day of days.slice(0, 7)) {
            const query = dailyAssetQuery(day);
            signal.throwIfAborted();
            const response = await this.readDailyAsset(source, config.account, day, signal);
            const row: LongbridgeDailyAsset = { day, sourceId: source.id, account: config.account,
              timeZone: "Asia/Shanghai", path: LONG_BRIDGE_DAILY_PATH, query, fetchedAt: this.clock.now().toISOString(), response };
            dailyAssetAmount(row, this.clock.now().toISOString());
            await archiveDailyAsset(this.dataDir, row);
            signal.throwIfAborted();
            await this.store.saveLongbridgeDailyAssets({ ...config, error: null, lastSuccessDay: day, nextAttemptAt: undefined }, [row], this.clock.now().toISOString(), token);
            await delay(1000, undefined, { signal });
          }
        } catch {
          await this.store.saveLongbridgeDailyAssets({ ...config, error: "daily-assets-unavailable", nextAttemptAt: new Date(this.clock.now().getTime() + 5 * 60_000).toISOString() }, [], this.clock.now().toISOString(), token);
          console.warn("长桥每日资产补取失败，保留已取得数据，稍后重试。");
        }
      }
    } finally {
      await this.store.releaseLongbridgeDailyAssets(token);
    }
  }
}
