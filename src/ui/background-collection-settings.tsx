import type { CollectionStatus } from "@/server/background-collection";
import { formatShanghaiDateTime } from "@/ui/shanghai-date-time";
import { VibeStatusTag } from "@/ui/vibe/vibe-data-instrument";

const time = (value: string | null) => value ? formatShanghaiDateTime(value) : "暂无记录";

export function BackgroundCollectionSettings({ status }: { status: CollectionStatus | null }) {
  const observed = status?.sources.filter(source => source.observedAt !== null).length ?? 0;
  const total = status?.sources.length ?? 0;
  const report = status?.state?.report;
  return (
    <section className="settings-section" aria-labelledby="background-collection-title">
      <h2 id="background-collection-title">后台自动采集</h2>
      <dl className="security-settings__statuses">
        <div><dt>后台检查</dt><dd><VibeStatusTag tone={status?.state?.error ? "warning" : status?.health === "running" ? "live" : "muted"}>
          {status?.health === "running" ? "最近三分钟内有检查" : status?.health === "stopped" ? "后台已停止或检查中断" : "尚无后台运行记录"}
        </VibeStatusTag></dd></div>
        <div><dt>最近检查</dt><dd>{time(status?.state?.checkedAt ?? null)}</dd></div>
        <div><dt>下次采集计划</dt><dd>{status?.nextCollectionAt ? time(status.nextCollectionAt) : "暂无自动来源"}</dd></div>
        <div><dt>最近后台批次</dt><dd>{report ? `成功 ${report.successCount} · 失败 ${report.failureCount} · 占用或已丢弃 ${report.supersededCount ?? 0}` : "暂无采集记录"}</dd></div>
        <div><dt>最近批次完成</dt><dd>{time(status?.state?.reportAt ?? null)}</dd></div>
        <div><dt>最近全量成功</dt><dd>{time(status?.state?.lastFullSuccessAt ?? null)}</dd></div>
        <div><dt>今日自动来源覆盖</dt><dd>{total ? `${observed} / ${total}` : "暂无自动来源"}</dd></div>
        <div><dt>今日首次凑齐</dt><dd>{status?.firstCompleteAt ? time(status.firstCompleteAt) : "尚未形成完整基准"}</dd></div>
        {status?.state?.error ? <div><dt>后台异常</dt><dd>最近执行未完成，请检查来源状态与本机后台日志。</dd></div> : null}
      </dl>
      {status?.sources.map(source => <div key={source.id}>
        <h3>{source.label}</h3>
        <dl className="security-settings__statuses">
          <div><dt>今日有效观测</dt><dd>{source.observedAt ? time(source.observedAt) : "今日尚未采集完整数据"}</dd></div>
          <div><dt>最近成功采集</dt><dd>{time(source.lastSuccessfulAt)}</dd></div>
          <div><dt>当前采集状态</dt><dd>{source.error ?? "正常"}</dd></div>
        </dl>
      </div>)}
      <p className="formal-daily-settlement-note">每分钟检查，到期后每小时全量采集；失败来源在本轮开始后第 5、15 分钟补试。睡眠或关机期间不采集，恢复后检查到期任务，不补造过去数据。以上时间均为上海时间，刷新页面可查看最新状态。</p>
      <p className="formal-daily-settlement-note">关闭网页或网页登录过期不影响采集；来源授权失效仍需重新授权。同日各来源累计保留最新有效观测，各来源的观测时间可能不同，后续失败不撤销已有观测。正式日结继续使用独立收盘口径。</p>
    </section>
  );
}
