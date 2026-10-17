import type { FormalSettlementExecution, FormalSettlementSchedulerStatus } from "@/server/ports";
import { formatShanghaiDateTime } from "@/ui/shanghai-date-time";
import { settlementOutcomeLabel, settlementQualityLabel, settlementReasonLabel, settlementSchedulerLabel } from "@/ui/formal-settlement-status";
import { VibeStatusTag } from "@/ui/vibe/vibe-data-instrument";

export function AutomaticDailySettlementSettings({ execution, scheduler }: {
  execution: FormalSettlementExecution | null;
  scheduler: FormalSettlementSchedulerStatus;
}) {
  return (
    <section id="automatic-daily-settlement" className="settings-section" aria-labelledby="automatic-daily-settlement-title">
      <h2 id="automatic-daily-settlement-title">自动日结</h2>
      <dl className="security-settings__statuses">
        <div><dt>本机调度</dt><dd><VibeStatusTag tone="muted">{settlementSchedulerLabel[scheduler.state]}</VibeStatusTag></dd></div>
        <div><dt>检查时间</dt><dd>{formatShanghaiDateTime(scheduler.checkedAt)}（上海时间）</dd></div>
        <div><dt>最近执行</dt><dd>{execution ? formatShanghaiDateTime(execution.startedAt) + "（上海时间）" : "暂无执行记录"}</dd></div>
        {execution ? <>
          <div><dt>执行结果</dt><dd>{settlementOutcomeLabel[execution.outcome]}</dd></div>
          {execution.settlementStatus ? <div><dt>日结质量</dt><dd>{settlementQualityLabel[execution.settlementStatus]}</dd></div> : null}
          {execution.reason ? <div><dt>原因</dt><dd>{settlementReasonLabel[execution.reason]}</dd></div> : null}
        </> : null}
      </dl>
      {/* 两段口径说明按「探测范围 / 计价口径」分列，避免糊成一段灰色墙。
          这两句是读法边界，不是告警，所以留在正文层级而不升级为提示条。 */}
      <div className="formal-daily-settlement-notes">
        <p className="formal-daily-settlement-note">
          <span className="formal-daily-settlement-note__label">探测范围</span>
          <span>
            仅检查本机 launchd 任务，外部调度状态未知。已加载或过去执行成功不代表当前采集正常；暂无记录不代表未启用。
          </span>
        </p>
        <p className="formal-daily-settlement-note">
          <span className="formal-daily-settlement-note__label">计价口径</span>
          <span>
            独立于实时刷新：证券按官方收盘价，加密资产按采集窗口市价。执行日志不纳入备份。
          </span>
        </p>
      </div>
    </section>
  );
}
