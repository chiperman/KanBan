"use client";

import { useState } from "react";

import type { Card, DailyAssetTrendObservation } from "@/server/ports";
import {
  DataHealthDiagnostics,
  diagnoseSources,
  type DataHealthSource,
  type DiagnosticSource,
} from "@/ui/data-health-diagnostics";
import { sourceSyncStatus } from "@/ui/asset-source-status";
import { formatShanghaiDateTime } from "@/ui/shanghai-date-time";
import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";

function sourceType(source: DataHealthSource): string {
  if (source.kind === "manual") return "手工资产记录";
  if (source.kind.startsWith("evm-watch-")) return "观察钱包";
  return "自动账户";
}

function sourceStatus(source: DataHealthSource, card?: Card): string {
  const visibility = card?.hidden ? " · 已隐藏" : "";
  if (source.kind === "manual") return `无凭证${visibility}`;
  if (source.lifecycle === "disconnected") return `已断开${visibility}`;
  return `${sourceSyncStatus(source)?.label ?? "已连接"}${visibility}`;
}

function SourceDirectoryRow({ diagnostic, card }: { diagnostic: DiagnosticSource; card?: Card }) {
  const [expanded, setExpanded] = useState(false);
  const { source, name, reasons, valuation, manualWithoutRecord } = diagnostic;
  const status = sourceStatus(source, card);
  const connectionLabel = source.kind === "manual" ? "手工记录"
    : source.lifecycle === "disconnected" ? "已断开"
      : source.sync.error !== null ? "同步失败 · 数据过期"
        : source.sync.status === "expired" ? "数据过期" : "已连接";
  const issueLabel = source.sync.error !== null ? "同步失败 · 数据过期"
    : source.sync.status === "expired" ? "数据过期" : valuation.label;
  const visibleStatus = reasons.length > 0 && issueLabel !== connectionLabel
    ? `${connectionLabel} · ${issueLabel}` : connectionLabel;
  const detailsId = `source-diagnostic-${source.id}`;

  return (
    <li data-testid={`data-health-source-${source.id}`}>
      <article className="asset-source-directory__row" data-attention={reasons.length > 0}>
        <VibeLink
          aria-label={`${name} · ${sourceType(source)} · ${status}`}
          className="asset-source-directory__link"
          href={`/asset-sources/${encodeURIComponent(source.id)}`}
          variant="text"
        >
          <span className="asset-source-directory__identity">
            <strong>{name}</strong>
            <span>{sourceType(source)}</span>
          </span>
        </VibeLink>
        <div className="asset-source-directory__meta">
          <div className="asset-source-directory__status">
            <span data-tone={reasons.length > 0 ? "issue" : "current"}>
              {visibleStatus}
            </span>
            {reasons.length > 0 ? (
              <VibeButton
                aria-controls={detailsId}
                aria-expanded={expanded}
                aria-label={`${expanded ? "收起" : "查看"} ${name} 异常`}
                onClick={() => setExpanded((current) => !current)}
                size="compact"
                type="button"
                variant="text"
              >
                {expanded ? "收起异常" : "查看异常"}
              </VibeButton>
            ) : null}
          </div>
          <span>{source.kind === "manual" ? "最近记录" : "最后成功"} · {manualWithoutRecord
            ? "尚无记录" : formatShanghaiDateTime(source.sync.lastSuccessfulAt)}</span>
          {card?.hidden ? <span>已隐藏</span> : null}
        </div>
        {expanded ? (
          <div className="asset-source-directory__diagnostic" id={detailsId}>
            <p>{valuation.label}</p>
            <ul aria-label={`${name} 诊断原因`}>
              {reasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          </div>
        ) : null}
      </article>
    </li>
  );
}

export function AssetSourceDirectory({ cards, sources, currentDay, history }: {
  cards: Card[];
  sources: DataHealthSource[];
  currentDay: string;
  history: DailyAssetTrendObservation[];
}) {
  const cardsBySourceId = new Map(cards.flatMap((card) => card.sourceId ? [[card.sourceId, card] as const] : []));
  const diagnostics = diagnoseSources(sources);
  const attentionCount = diagnostics.filter(({ reasons }) => reasons.length > 0).length;
  const sourcesByReason = new Map<string, DiagnosticSource[]>();
  for (const diagnostic of diagnostics) {
    for (const reason of diagnostic.reasons) {
      sourcesByReason.set(reason, [...(sourcesByReason.get(reason) ?? []), diagnostic]);
    }
  }
  const sharedDiagnostics = [...sourcesByReason].filter(([, matched]) => matched.length > 1);

  return (
    <div className="data-health-diagnostics" data-testid="data-health-diagnostics">
      <section aria-label="资产来源列表" className="asset-source-directory">
        <div className="data-health-section-heading">
          <h2>账户与来源</h2>
          <p aria-label={`共 ${sources.length} 个来源，${sources.length - attentionCount} 个正常，${attentionCount} 个需关注`}>
            {sources.length} 个来源 · {attentionCount > 0 ? `${attentionCount} 个需关注` : "全部正常"}
          </p>
        </div>
        {sharedDiagnostics.length > 0 ? (
          <ul aria-label="共同诊断" className="data-health-shared-diagnostics">
            {sharedDiagnostics.map(([reason, matched]) => (
              <li key={reason}>
                <p>影响 {matched.length} 个来源</p>
                <strong>{reason}</strong>
                <span>{matched.map(({ name }) => name).join("、")}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {sources.length === 0 ? (
          <div className="empty-state"><p className="empty-title">暂无资产来源</p></div>
        ) : (
          <ol className="asset-source-directory__list">
            {diagnostics.map((diagnostic) => (
              <SourceDirectoryRow card={cardsBySourceId.get(diagnostic.source.id)} diagnostic={diagnostic} key={diagnostic.source.id} />
            ))}
          </ol>
        )}
      </section>
      <DataHealthDiagnostics currentDay={currentDay} history={history} sources={sources} />
    </div>
  );
}
