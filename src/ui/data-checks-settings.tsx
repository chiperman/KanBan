"use client";

import type { DailyAssetTrendObservation } from "@/server/ports";
import { DataHealthDiagnostics, diagnoseSources, type DataHealthSource } from "@/ui/data-health-diagnostics";
import { VibeEntityLink } from "@/ui/vibe/vibe-entity-link";
import { VibeStatusTag } from "@/ui/vibe/vibe-data-instrument";
import { AssetSourceRecoveryAction } from "@/ui/asset-source-recovery";

export function DataChecksSettings({ currentDay, history, sources }: {
  currentDay: string;
  history: DailyAssetTrendObservation[];
  sources: DataHealthSource[];
}) {
  const diagnostics = diagnoseSources(sources);
  const attention = diagnostics.filter(({ reasons }) => reasons.length > 0);
  const reasons = attention.flatMap(({ reasons }) => reasons);
  const tone = reasons.some(reason => reason.tone === "error")
    ? "error"
    : reasons.some(reason => reason.tone === "warning")
      ? "warning"
      : attention.length || sources.length === 0 ? "muted" : "success";

  return (
    <div className="data-maintenance-section__content data-checks">
      <section aria-labelledby="source-checks-title">
        <header className="data-maintenance-subheading">
          <h3 id="source-checks-title">同步与估值</h3>
          <VibeStatusTag tone={tone}>
            {sources.length === 0 ? "暂无来源" : attention.length ? `${attention.length} 个来源需关注` : `${sources.length} 个来源正常`}
          </VibeStatusTag>
        </header>
        {attention.length > 0 ? (
          <ul className="data-checks__issues" aria-label="数据异常">
            {attention.map(({ name, reasons, source }) => (
              <li className="data-checks__issue" key={source.id}>
                <div className="data-checks__source-action">
                  <VibeEntityLink href={`/asset-sources/${encodeURIComponent(source.id)}?view=manage`}>{name}</VibeEntityLink>
                  {reasons.some(reason => reason.recovery)
                    ? <AssetSourceRecoveryAction source={{ ...source, displayName: name }} /> : null}
                </div>
                <ul className="data-checks__issue-reasons">
                  {reasons.map(reason => (
                    <li key={`${reason.tone}:${reason.label}`}>
                      <p data-vibe-tone={reason.tone}>{reason.label}</p>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <DataHealthDiagnostics currentDay={currentDay} history={history} sources={sources} />
    </div>
  );
}
