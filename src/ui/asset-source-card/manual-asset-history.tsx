"use client";

import type { ManualAssetRecord } from "@/server/ports";
import { assetSourceDisplayName } from "@/domain/asset-source-display-name";
import { formatShanghaiDateTime } from "@/ui/shanghai-date-time";
import { AssetFinancialValue } from "@/ui/asset-financial-value";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { useTablePagination, VibeTablePagination } from "@/ui/vibe/vibe-table-pagination";
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
  const manualRecords = source.manualRecords ?? [];
  const pagination = useTablePagination(manualRecords, source.id);
  if (manualRecords.length === 0) return null;
  return (
    <>
      <p className="asset-updated">
        最近记录日期：{manualRecords[0]?.day ?? formatShanghaiDateTime(source.snapshot.syncedAt)}
      </p>
      <section className="manual-asset-history" aria-label={`${heading.title}历史记录`}>
        <p className="card-label">历史记录</p>
        <ol className="manual-asset-history-list">
          {pagination.visibleItems.map((record) => (
            <li key={record.day}>
              <span>{record.day}</span>
              <strong>
                {showSensitiveInfo
                  ? <AssetFinancialValue unit={record.currency}>
                      {formatAmount(record.amount)}
                    </AssetFinancialValue>
                  : "••••••"}
              </strong>
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
        <VibeTablePagination label={`${heading.title}历史记录分页`} pagination={pagination.controls} />
      </section>
    </>
  );
}
