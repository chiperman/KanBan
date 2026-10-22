"use client";

import type { DailyAssetTrendObservation } from "@/server/ports";
import { DataHealthDiagnostics, diagnoseSources, type DataHealthSource } from "@/ui/data-health-diagnostics";
import { VibeEntityLink } from "@/ui/vibe/vibe-entity-link";
import { VibeStatusTag } from "@/ui/vibe/vibe-data-instrument";

export function DataChecksSettings({ currentDay, history, sources }: {
  currentDay: string;
  history: DailyAssetTrendObservation[];
  sources: DataHealthSource[];
}) {
  const diagnostics = diagnoseSources(sources);
  const attention = diagnostics.filter(({ reasons }) => reasons.length > 0);
  const sourcesByReason = new Map<string, typeof diagnostics>();
  for (const diagnostic of attention) {
    for (const reason of new Set(diagnostic.reasons)) {
      sourcesByReason.set(reason, [...(sourcesByReason.get(reason) ?? []), diagnostic]);
    }
  }

  return (
    <div className="data-maintenance-section__content data-checks">
      <section aria-labelledby="source-checks-title">
        <header className="data-maintenance-subheading">
          <h3 id="source-checks-title">同步与估值</h3>
          <VibeStatusTag tone={attention.length ? "warning" : "muted"}>
            {sources.length === 0 ? "暂无来源" : attention.length ? `${attention.length} 个来源需关注` : `${sources.length} 个来源正常`}
          </VibeStatusTag>
        </header>
        {attention.length > 0 ? (
          <ul className="data-checks__issues" aria-label="数据异常">
            {[...sourcesByReason].map(([reason, affected]) => (
              <li key={reason}>
                <p>{reason}</p>
                <div>
                  {affected.map(({ source, name }) => (
                    <VibeEntityLink key={source.id} href={`/asset-sources/${encodeURIComponent(source.id)}?view=manage`}>
                      {name}
                    </VibeEntityLink>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <DataHealthDiagnostics currentDay={currentDay} history={history} sources={sources} />
    </div>
  );
}
