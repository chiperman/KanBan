"use client";

import type { ManualAssetRecord } from "@/server/ports";
import { assetSourceDisplayName } from "@/domain/asset-source-display-name";
import { formatShanghaiDateTime } from "@/ui/shanghai-date-time";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeStatusTag } from "@/ui/vibe/vibe-data-instrument";
import type { AssetSourceView } from "./types";

export function ManualAssetHistory({
  source,
  showSensitiveInfo,
  formatAmount,
  onManualAssetRecord,
  onManualAssetRecordDelete,
  onReadOnlyAction,
}: {
  source: AssetSourceView;
  showSensitiveInfo: boolean;
  formatAmount: (value: string) => string;
  onManualAssetRecord?: (source: AssetSourceView, record?: ManualAssetRecord) => void;
  onManualAssetRecordDelete?: (source: AssetSourceView, record: ManualAssetRecord) => void;
  onReadOnlyAction?: () => void;
}) {
  const heading = { title: assetSourceDisplayName(source) };
  const hasManualRecord = source.hasManualRecord !== false;
  const manualRecords = source.manualRecords ?? [];
  return (
    <>
      <VibeStatusTag className="asset-sync-status" tone="muted">
        {hasManualRecord
          ? "每日一条总额"
          : "等待首条数据"}
      </VibeStatusTag>
      {hasManualRecord ? (
        <p className="asset-updated">
          最近记录日期：{manualRecords[0]?.day ?? formatShanghaiDateTime(source.snapshot.syncedAt)}
        </p>
      ) : null}
      <section className="manual-asset-history" aria-label={`${heading.title}历史记录`}>
        <p className="card-label">历史记录</p>
        {manualRecords.length === 0 ? (
          <p className="trend-empty">尚无历史记录</p>
        ) : (
          <ol className="manual-asset-history-list">
            {manualRecords.map((record) => (
              <li key={record.day}>
                <span>{record.day}</span>
                <strong>{showSensitiveInfo ? `${formatAmount(record.amount)} ${record.currency}` : "••••••"}</strong>
                <span className="manual-asset-history-actions">
                  <VibeButton
                    data-demo-disabled={onReadOnlyAction ? "true" : undefined}
                    onClick={() => {
                      if (onReadOnlyAction) {
                        onReadOnlyAction();
                        return;
                      }
                      onManualAssetRecord?.(source, record);
                    }}
                    type="button"
                    variant="text"
                  >
                    编辑
                  </VibeButton>
                  <VibeButton
                    data-demo-disabled={onReadOnlyAction ? "true" : undefined}
                    onClick={() => {
                      if (onReadOnlyAction) {
                        onReadOnlyAction();
                        return;
                      }
                      onManualAssetRecordDelete?.(source, record);
                    }}
                    type="button"
                    variant="text"
                  >
                    删除
                  </VibeButton>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
