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
      <p className="formal-daily-settlement-note">仅检查本机 launchd 任务，外部调度状态未知。已加载或过去执行成功不代表当前采集正常；暂无记录不代表未启用。</p>
      <p className="formal-daily-settlement-note">正式日结独立于实时刷新：证券使用官方常规盘收盘价，加密资产使用采集窗口市价。执行记录不纳入业务备份。</p>
    </section>
  );
}
