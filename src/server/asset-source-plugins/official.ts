/**
 * 官方发行版中唯一允许运行的来源与服务插件。
 *
 * 插件仍按独立进程运行，便于保留长桥 OAuth 和供应商代码边界；
 * 但它们随 KanBan 应用一起构建，不从正式数据目录安装或更新。
 */
export const OFFICIAL_PLUGIN_IDS = [
  "binance",
  "okx",
  "bitget",
  "bit",
  "evm-watch-ethereum",
  "evm-watch-bsc",
  "longbridge",
  "plugin:coingecko",
] as const;

export const OFFICIAL_PLUGIN_REPOSITORY = "chiperman/KanBan";

const officialPluginIds = new Set<string>(OFFICIAL_PLUGIN_IDS);

export function isOfficialPluginId(id: string): boolean {
  return officialPluginIds.has(id);
}

export function officialPluginRepositoryUrl(): string {
  return `https://github.com/${OFFICIAL_PLUGIN_REPOSITORY}`;
}
