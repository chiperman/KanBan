import type { CollectionStatus } from "@/server/background-collection";
import { formatShanghaiDateTime } from "@/ui/shanghai-date-time";
import { VibeSegmentedBar, VibeStatusTag } from "@/ui/vibe/vibe-data-instrument";
import { VibeNotice } from "@/ui/vibe/vibe-notice";

const time = (value: string | null) => value ? formatShanghaiDateTime(value) : "暂无记录";

export function BackgroundCollectionSettings({ status }: { status: CollectionStatus | null }) {
  const observed = status?.sources.filter(source => source.observedAt !== null).length ?? 0;
  const total = status?.sources.length ?? 0;
  const report = status?.state?.report;
  const running = status?.health === "running";
  const hasSourceErrors = status?.sources.some((source) => source.error) ?? false;

  return (
    <section className="background-collection" aria-labelledby="background-collection-title">
      <header className="background-collection__header">
        <div>
          <h3 id="background-collection-title">后台采集</h3>
        </div>
        <VibeStatusTag tone={status?.state?.error || status?.health === "stopped" ? "error" : running ? "success" : "muted"}>
          {status?.state?.error ? "最近执行失败" : running ? "近期有检查" : status?.health === "stopped" ? "检查已中断" : "暂无运行记录"}
        </VibeStatusTag>
      </header>

      {status?.state?.error ? (
        <VibeNotice tone="error">最近执行未完成，请检查来源状态与本机后台日志。</VibeNotice>
      ) : null}

      {status?.state?.sdkAuthorization?.error ? (
        <VibeNotice tone="error">
          {status.state.sdkAuthorization.error}
          {status.state.sdkAuthorization.nextRetryAt ? `；下次补试：${time(status.state.sdkAuthorization.nextRetryAt)}` : ""}
        </VibeNotice>
      ) : null}

      <dl className="background-collection__overview">
        <div>
          <dt>下次采集计划</dt>
          <dd className="background-collection__next">
            {status?.nextCollectionAt ? time(status.nextCollectionAt) : "暂无自动来源"}
            <span className="background-collection__hint">{running ? "每分钟检查到期任务" : "计划执行需后台保持运行"}</span>
          </dd>
        </div>
        <div>
          <dt>今日自动来源覆盖</dt>
          <dd>
            <div className="background-collection__coverage">
              {total ? <><strong>{observed}</strong><span>/ {total} 个来源</span></> : "暂无自动来源"}
            </div>
            {total ? <VibeSegmentedBar
              ariaLabel={`今日已有 ${observed} 个自动来源取得有效观测，共 ${total} 个来源`}
              compact
              segments={[{ key: "observed", value: observed }]}
              total={total}
            /> : null}
          </dd>
        </div>
        <div>
          <dt>最近后台批次</dt>
          <dd>
            {report ? <div className="background-collection__batch">
              <span>成功 <strong>{report.successCount}</strong></span>
              <span data-failed={report.failureCount > 0}>失败 <strong>{report.failureCount}</strong></span>
              <span>占用或已丢弃 <strong>{report.supersededCount ?? 0}</strong></span>
            </div> : "暂无采集记录"}
          </dd>
        </div>
      </dl>

      <details className="data-maintenance-disclosure" open={hasSourceErrors}>
        <summary>查看采集记录与来源状态</summary>
        <dl className="background-collection__timestamps">
          <div><dt>最近检查</dt><dd>{time(status?.state?.checkedAt ?? null)}</dd></div>
          <div><dt>最近批次完成</dt><dd>{time(status?.state?.reportAt ?? null)}</dd></div>
          <div><dt>最近全量成功</dt><dd>{time(status?.state?.lastFullSuccessAt ?? null)}</dd></div>
          <div><dt>今日首次凑齐</dt><dd>{status?.firstCompleteAt ? time(status.firstCompleteAt) : "尚未形成完整基准"}</dd></div>
        </dl>

        <div className="background-collection__sources">
          <div className="background-collection__sources-header">
            <h3>来源采集状态</h3>
            <span>上海时间，刷新页面查看最新状态</span>
          </div>
          {total ? <ul className="background-collection__source-list">
            {status?.sources.map(source => <li className="background-collection__source" key={source.id}>
              <div className="background-collection__source-name">
                <h4>{source.label}</h4>
                <VibeStatusTag tone={source.error ? "error" : source.observedAt || source.lastSuccessfulAt ? "success" : "muted"}>
                  {source.error ? "采集异常" : source.observedAt || source.lastSuccessfulAt ? "正常" : "尚未采集"}
                </VibeStatusTag>
              </div>
              <dl className="background-collection__source-times">
                <div><dt>今日有效观测</dt><dd>{source.observedAt ? time(source.observedAt) : "今日尚未采集完整数据"}</dd></div>
                <div><dt>最近成功采集</dt><dd>{time(source.lastSuccessfulAt)}</dd></div>
              </dl>
              {source.error ? <p className="background-collection__source-error">{source.error}</p> : null}
            </li>)}
          </ul> : <p className="background-collection__empty">暂无自动来源，连接自动来源后可在此查看采集状态。</p>}
        </div>
      </details>

      <details className="background-collection__rules">
        <summary>采集规则与数据口径</summary>
        <div className="background-collection__rule-list">
          <p><strong>运行与补试</strong><span>每分钟检查，到期后每小时全量采集；失败来源在本轮开始后第 5、15 分钟补试。最近三分钟内有检查仅表示后台近期运行，不代表采集成功。</span></p>
          <p><strong>后台运行</strong><span>关闭网页或网页登录过期不影响采集；来源授权失效仍需重新授权。睡眠或关机期间不采集，恢复后检查到期任务，不补造过去数据。</span></p>
          <p><strong>数据口径</strong><span>同日各来源累计保留最新有效观测，各来源的观测时间可能不同，后续失败不撤销已有观测。正式日结继续使用独立收盘口径。以上时间均为上海时间。</span></p>
        </div>
      </details>
    </section>
  );
}
