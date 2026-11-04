import { assetSourceDisplayName } from "@/domain/asset-source-display-name";
import { type BookRecord } from "@/domain/investment-books";
import type { ManualAssetRecord } from "@/server/ports";
import { AssetFinancialValue } from "@/ui/asset-financial-value";
import { InvestmentBookRecordAmount } from "@/ui/investment-book-record-amount";
import { ManualAssetRecordCheck } from "@/ui/manual-asset-record-dialog";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { useTablePagination, VibeTablePagination } from "@/ui/vibe/vibe-table-pagination";

import { bookMoney, type InvestmentBookSource } from "./shared";

import type { BookAnalysis, buildBookTimeline } from "./model";

export type BookRecordFilter = "all" | "funds" | "valuations";
type TimelineRow = ReturnType<typeof buildBookTimeline>[number];

export function BookRecordsView({
  analysis,
  showSensitiveInfo,
  checkSourceId,
  initialRecordDay,
  checkSource,
  manualRecords,
  recordFilter,
  setRecordFilter,
  filteredTimeline,
  recordPagination,
  depositTotals,
  setDialog,
  setEditing,
  setVoiding,
  setAssetDay,
}: {
  analysis: BookAnalysis;
  showSensitiveInfo: boolean;
  checkSourceId?: string;
  initialRecordDay?: string;
  checkSource?: InvestmentBookSource;
  manualRecords: ManualAssetRecord[];
  recordFilter: BookRecordFilter;
  setRecordFilter(value: BookRecordFilter): void;
  filteredTimeline: TimelineRow[];
  recordPagination: ReturnType<typeof useTablePagination<TimelineRow>>;
  depositTotals: Map<string, string | null>;
  setDialog(value: "import" | "asset"): void;
  setEditing(record: BookRecord): void;
  setVoiding(record: BookRecord): void;
  setAssetDay(day: string): void;
}) {
  return (
    <section className="source-performance" aria-label="统一记账记录">
      <header className="investment-books__section-heading">
        <h2>记账记录</h2>
        <VibeButton type="button" variant="outline" onClick={() => setDialog("import")}>
          导入历史记账
        </VibeButton>
      </header>
      {checkSourceId && initialRecordDay ? (
        checkSource ? (
          <ManualAssetRecordCheck
            sourceId={checkSource.id}
            sourceName={assetSourceDisplayName(checkSource)}
            day={initialRecordDay}
            records={manualRecords}
          />
        ) : (
          <VibeNotice tone="warning">
            来源不可用，暂时无法核对资产记录。请先核对来源状态。
          </VibeNotice>
        )
      ) : null}
      <div className="investment-books__record-toolbar">
        <div className="investment-books__record-filters" role="group" aria-label="记账记录类型">
          {(
            [
              ["all", "全部记录"],
              ["funds", "出入金"],
              ["valuations", "资产估值"],
            ] as const
          ).map(([value, label]) => (
            <VibeButton
              key={value}
              type="button"
              aria-pressed={recordFilter === value}
              variant={recordFilter === value ? "primary" : "outline"}
              onClick={() => setRecordFilter(value)}
            >
              {label}
            </VibeButton>
          ))}
        </div>
      </div>
      {showSensitiveInfo && filteredTimeline.length === 0 ? (
        <div className="investment-books__empty">
          <p className="trend-note">
            暂无
            {recordFilter === "funds"
              ? "出入金"
              : recordFilter === "valuations"
                ? "资产估值"
                : "记账"}
            记录。
          </p>
        </div>
      ) : null}
      {showSensitiveInfo ? (
        <ol className="manual-asset-history-list investment-books__record-list">
          {recordPagination.visibleItems.map((row) => (
            <li key={row.key} title={row.record?.note}>
              <div className="investment-books__record-identity">
                <time dateTime={row.day}>{row.day}</time>
                <span>
                  {row.label}
                  <small className="investment-books__basis">{row.basis}</small>
                </span>
              </div>
              <strong className="investment-books__record-amount">
                <InvestmentBookRecordAmount
                  amount={row.amount}
                  currency={row.record?.currency ?? analysis.book.currency}
                  record={row.record}
                />
                {row.kind === "deposit" ? (
                  <small className="investment-books__basis investment-books__record-total">
                    <span>累计净投入</span>
                    <span>
                      {depositTotals.get(row.key) == null ? (
                        "数据不足"
                      ) : (
                        <AssetFinancialValue unit={analysis.book.currency}>
                          {bookMoney(depositTotals.get(row.key)!)}
                        </AssetFinancialValue>
                      )}
                    </span>
                  </small>
                ) : null}
              </strong>
              <div className="source-performance__record-actions">
                {row.record ? (
                  <>
                    {row.record.currency === analysis.book.currency ? (
                      <VibeButton
                        type="button"
                        variant="text"
                        onClick={() => setEditing(row.record!)}
                        aria-label={`更正 ${row.day} ${row.label}`}
                      >
                        更正
                      </VibeButton>
                    ) : null}
                    <VibeButton
                      type="button"
                      variant="text"
                      tone="danger"
                      onClick={() => setVoiding(row.record!)}
                      aria-label={`作废 ${row.day} ${row.label}`}
                    >
                      作废
                    </VibeButton>
                  </>
                ) : row.basis === "手动资产金额" ? (
                  <VibeButton
                    type="button"
                    variant="text"
                    onClick={() => {
                      setAssetDay(row.day);
                      setDialog("asset");
                    }}
                  >
                    更新资产
                  </VibeButton>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="trend-note">金额及记录已隐藏。</p>
      )}
      {showSensitiveInfo ? (
        <VibeTablePagination label="记账记录分页" pagination={recordPagination.controls} />
      ) : null}
    </section>
  );
}
