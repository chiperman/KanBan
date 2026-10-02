import type { FormalSettlementRunReason, FormalSettlementRunResult, FormalSettlementStatus, FormalSettlementSchedulerStatus } from "@/server/ports";

export const settlementQualityLabel: Record<FormalSettlementStatus, string> = {
  complete: "完整", incomplete: "不完整", missed: "错过窗口",
};
export const settlementOutcomeLabel: Record<FormalSettlementRunResult["outcome"], string> = {
  "not-due": "本次未生成", waiting: "等待行情", recorded: "已写入日结记录",
  "already-recorded": "已有日结记录，未重复写入", error: "执行失败",
};
export const settlementReasonLabel: Record<FormalSettlementRunReason, string> = {
  "no-sources": "没有可参与日结的资产来源",
  "before-window": "尚未到采集窗口",
  "official-close-pending": "官方收盘行情尚未齐备，本次未生成日结",
  "source-read-failed": "资产来源读取失败，本次未生成日结",
  "candle-read-failed": "官方日 K 读取失败，本次未生成日结",
  "capture-window-missed": "采集窗口内未形成日结，未使用之后的实时数据补写",
  "incomplete-evidence": "估值或来源证据不完整，请查看资产来源",
  "execution-failed": "本次执行未正常完成，详细错误已隐藏",
  "execution-record-failed": "执行记录未能保存，无法确认本次执行状态",
};
export const settlementSchedulerLabel: Record<FormalSettlementSchedulerStatus["state"], string> = {
  loaded: "本机任务已加载",
  "not-loaded": "本机配置存在，任务未加载",
  "plist-missing": "未发现本机任务配置",
  "query-failed": "调度状态未知：无法确认本机任务",
  unsupported: "调度状态未知：当前平台不支持本机探测",
};
