import type { FormalSettlementExecution, FormalSettlementSchedulerStatus } from "@/server/ports";
import { formatShanghaiDateTime } from "@/ui/shanghai-date-time";
import { settlementOutcomeLabel, settlementQualityLabel, settlementReasonLabel, settlementSchedulerLabel } from "@/ui/formal-settlement-status";
import { VibeStatusTag } from "@/ui/vibe/vibe-data-instrument";

export function AutomaticDailySettlementSettings({ execution, scheduler, backgroundActive = false }: {
  execution: FormalSettlementExecution | null;
  backgroundActive?: boolean;
  scheduler: FormalSettlementSchedulerStatus;
}) {
  return (
    <section id="automatic-daily-settlement" className="automatic-daily-settlement" aria-labelledby="automatic-daily-settlement-title">
      <h3 id="automatic-daily-settlement-title">正式日结</h3>
      <dl className="security-settings__statuses">
        <div><dt>本机调度</dt><dd><VibeStatusTag tone={backgroundActive || scheduler.state === "loaded" ? "success" : scheduler.state === "not-loaded" || scheduler.state === "query-failed" ? "error" : "muted"}>{backgroundActive ? "由后台采集每十五分钟检查" : settlementSchedulerLabel[scheduler.state]}</VibeStatusTag></dd></div>
        <div><dt>检查时间</dt><dd>{formatShanghaiDateTime(scheduler.checkedAt)}（上海时间）</dd></div>
        <div><dt>最近执行</dt><dd>{execution ? formatShanghaiDateTime(execution.startedAt) + "（上海时间）" : "暂无执行记录"}</dd></div>
        {execution ? <>
          <div><dt>执行结果</dt><dd><VibeStatusTag tone={execution.outcome === "error" ? "error" : execution.outcome === "waiting" ? "warning" : execution.outcome === "not-due" ? "muted" : "success"}>{settlementOutcomeLabel[execution.outcome]}</VibeStatusTag></dd></div>
          {execution.settlementStatus ? <div><dt>日结质量</dt><dd><VibeStatusTag tone={execution.settlementStatus === "complete" ? "success" : "error"}>{settlementQualityLabel[execution.settlementStatus]}</VibeStatusTag></dd></div> : null}
          {execution.reason ? <div><dt>原因</dt><dd>{settlementReasonLabel[execution.reason]}</dd></div> : null}
        </> : null}
      </dl>
      <details className="data-maintenance-disclosure">
        <summary>日结规则与计价口径</summary>
        <div className="formal-daily-settlement-notes">
          <p className="formal-daily-settlement-note">
            <span className="formal-daily-settlement-note__label">探测范围</span>
            <span>
              后台采集运行时同时检查正式日结；未检测到后台心跳时，显示独立日结任务的本机调度状态。过去执行成功不代表当前采集正常。
            </span>
          </p>
          <p className="formal-daily-settlement-note">
            <span className="formal-daily-settlement-note__label">计价口径</span>
            <span>
              独立于实时刷新：证券按官方收盘价，加密资产按采集窗口市价。执行日志不纳入备份。
            </span>
          </p>
        </div>
      </details>
    </section>
  );
}
