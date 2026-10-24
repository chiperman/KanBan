"use client";

import { formatAssetAmount } from "@/ui/asset-price-display";
import { useMemo, useState } from "react";
import { decimalMultiply } from "@/domain/decimal";
import { rangeDays } from "@/domain/investment-performance-trend";
import { analyzeSourceInvestmentAccount, type SourceInvestmentHistory } from "@/domain/source-investment-history";
import type { ValuationSource } from "@/domain/valuation";
import type { SourceInvestmentRecord } from "@/domain/source-investment-records";
import type { DailyAssetTrendObservation, ManualAssetRecord } from "@/server/ports";
import { AssetTrendPanel, type AssetTrendRange } from "@/ui/asset-trend-panel";
import { formatShanghaiDayLabel } from "@/ui/shanghai-date-time";
import { AssetFinancialValue } from "@/ui/asset-financial-value";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeMetric } from "@/ui/vibe/vibe-data-instrument";
import { useTablePagination, VibeTablePagination } from "@/ui/vibe/vibe-table-pagination";

// 金额始终按十进制字符串格式化，避免大额金额经 Number 转换后丢精度。
function money(value: string): string {
  return formatAssetAmount(value);
}

export function SourceInvestmentPerformance({ history, sourceId, sourceName, records, observations, source, manualRecords, currentDay, range, showSensitiveInfo, onEdit, onDelete }: {
  history: SourceInvestmentHistory | null;
  sourceId: string;
  sourceName: string;
  records: SourceInvestmentRecord[];
  observations: DailyAssetTrendObservation[];
  source?: ValuationSource;
  manualRecords: ManualAssetRecord[];
  currentDay: string;
  range: AssetTrendRange;
  showSensitiveInfo: boolean;
  onEdit?(record: SourceInvestmentRecord): void;
  onDelete?(record: SourceInvestmentRecord): void;
}) {
  const [curve, setCurve] = useState<"return" | "profit" | "total">("return");
  const analysis = useMemo(() => analyzeSourceInvestmentAccount({history, sourceId, records, observations, source, manualRecords, currentDay}), [history, sourceId, records, observations, source, manualRecords, currentDay]);
  const manualPagination = useTablePagination(records.toSorted((a,b)=>b.day.localeCompare(a.day)||b.recordedAt.localeCompare(a.recordedAt)), sourceId);
  const importedPagination = useTablePagination(history?.records.toReversed() ?? [], sourceId);
  const days = rangeDays(range.preset, currentDay, analysis.points[0]?.day, range.customRange);
  const byDay = new Map(analysis.points.map(point => [point.day, point]));
  const firstObservation = analysis.points[0]?.day;
  const points = days.filter(day => !firstObservation || day >= firstObservation).map(day => {
    const point = byDay.get(day);
    const value = curve === "total" ? point?.total ?? null : curve === "profit" ? point?.profit ?? null : point?.returnRatio == null ? null : decimalMultiply(point.returnRatio, "100");
    return { day, amount: value, observed: point !== undefined, status: value === null ? "incomplete" as const : "complete" as const };
  });
  const current = analysis.current;
  const rate = current?.returnRatio == null ? null : decimalMultiply(current.returnRatio, "100");
  const metrics = [
    { label: "累计净投入", amount: current?.netInvestment ?? null, unit: analysis.currency ?? "" },
    { label: "累计收益", amount: current?.profit ?? null, unit: analysis.currency ?? "" },
    { label: "资金加权收益率", amount: rate, unit: "%" },
  ];
  return <section aria-label={`${sourceName}投资收益`} className="source-performance" data-testid="source-investment-performance">
    <header className="source-performance__heading">
      <h3>投资表现</h3>
      {showSensitiveInfo && current ? <p>截至 {current.day}</p> : null}
    </header>
    {analysis.points.length === 0 ? <p className="trend-empty" role="status">{showSensitiveInfo ? analysis.missingReason ?? "暂无收益记录" : "金额及趋势已隐藏"}</p> : <>
    <div className="source-performance__metrics">
      {metrics.map(metric => <article key={metric.label}>
        <p className="card-label">{metric.label}</p>
        <VibeMetric animate={false} className={showSensitiveInfo && metric.amount === null ? "source-performance__unavailable" : undefined} unit={metric.unit} value={!showSensitiveInfo ? "••••••" : metric.amount === null ? "数据不足" : money(metric.amount)} />
      </article>)}
    </div>
    <AssetTrendPanel
      range={{ ...range, firstDay: analysis.points[0]?.day ?? range.firstDay }}
      metricControls={<div className="source-performance__curve-options" role="group" aria-label="趋势指标">
        {(["total", "profit", "return"] as const).map(value => <VibeButton key={value} type="button" variant={curve === value ? "primary" : "outline"} size="compact" aria-pressed={curve === value} onClick={() => setCurve(value)}>{value === "total" ? "资产总额" : value === "profit" ? "累计收益" : "收益率"}</VibeButton>)}
      </div>}
      ariaLabel={`${sourceName}${curve === "return" ? "收益率曲线" : curve === "profit" ? "累计收益曲线" : "资产总额趋势"}`}
      currency={curve === "return" ? "%" : analysis.currency ?? "USD"}
      formatAmount={curve === "return" ? value => formatAssetAmount(value) : money}
      formatDay={formatShanghaiDayLabel}
      chartHeight={256}
      points={points}
      isSensitiveHidden={!showSensitiveInfo}
      emptyMessage={analysis.missingReason ?? "所选区间无可用趋势"}
      variant="source"
    >
      <div className="source-performance__chart-caption">
        <span>{curve === "return" ? "累计资金加权收益率，%" : `${curve === "total" ? "资产总额" : "累计收益"}，${analysis.currency ?? "账户原币"}`}</span>
        <span>{curve === "return" ? "Modified Dietz，不年化" : curve === "total" ? "含资金进出与估值变化" : "资产金额 − 累计净投入"}</span>
      </div>
    </AssetTrendPanel>
    </>}
    <div className="source-performance__details">
    <details className="daily-trend-details source-performance__method">
      <summary>计算口径与数据规则</summary>
      <div className="daily-trend-details-content">
        <p>累计收益 = 当天资产金额 − 当天累计净投入。</p>
        <p>收益率按资金发生日加权（Modified Dietz），记账以来累计、不年化；切换区间只筛选日期。</p>
        <p>仅在实际资产记录日计算；图表从首条资产记录开始。同日导入金额优先，其次为手动记录，再次为刷新数据。</p>
      </div>
    </details>
    {showSensitiveInfo && records.length ? <details className="daily-trend-details source-performance__records">
      <summary>手动记账记录（{records.length} 条）</summary>
      <ol className="manual-asset-history-list">
        {manualPagination.visibleItems.map(record=><li key={record.id}>
          <span>{record.day}</span><span>{{opening:"期初本金",deposit:"投入",withdrawal:"取出",valuation:"当天资产金额"}[record.kind]}</span>
          <strong><AssetFinancialValue unit={record.currency}>{money(record.amount)}</AssetFinancialValue></strong>
          {onEdit && onDelete ? <div className="source-performance__record-actions">
            <VibeButton type="button" variant="text" onClick={()=>onEdit(record)} aria-label={`编辑 ${record.day} ${record.amount} ${record.currency} 记录`}>编辑</VibeButton>
            <VibeButton type="button" variant="text" tone="danger" onClick={()=>onDelete(record)} aria-label={`删除 ${record.day} ${record.amount} ${record.currency} 记录`}>删除</VibeButton>
          </div> : null}
        </li>)}
      </ol>
      <VibeTablePagination label="手动记账记录分页" pagination={manualPagination.controls} />
    </details> : null}
    {showSensitiveInfo && history ? <details className="daily-trend-details">
      <summary>导入记账记录（{history.records.length} 条）</summary>
      <p className="trend-note">{history.accountName}，期初本金 {history.openingInvestment.day}：<AssetFinancialValue unit={history.currency}>{money(history.openingInvestment.amount)}</AssetFinancialValue>。{history.openingBasis}。</p>
      <ol className="manual-asset-history-list">
        {importedPagination.visibleItems.map(record => <li key={record.id}>
          <span>{record.day}</span>
          <span>{record.kind === "valuation" ? "当天资产金额" : record.kind === "deposit" ? "投入" : "取出"}</span>
          <strong><AssetFinancialValue unit={history.currency}>{money(record.amount)}</AssetFinancialValue></strong>
        </li>)}
      </ol>
      <VibeTablePagination label="导入记账记录分页" pagination={importedPagination.controls} />
    </details> : null}
    </div>
  </section>;
}
