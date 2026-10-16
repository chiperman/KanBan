"use client";

import { useMemo, useState, type ReactNode } from "react";
import { decimalMultiply, decimalToFixed } from "@/domain/decimal";
import { rangeDays, type InvestmentPerformanceCustomRange, type InvestmentPerformanceIntervalPreset } from "@/domain/investment-performance-trend";
import { analyzeSourceInvestmentAccount, type SourceInvestmentHistory } from "@/domain/source-investment-history";
import type { ValuationSource } from "@/domain/valuation";
import type { SourceInvestmentRecord } from "@/domain/source-investment-records";
import type { DailyAssetTrendObservation, ManualAssetRecord } from "@/server/ports";
import { AssetTrendChart } from "@/ui/asset-trend-chart";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeMetric } from "@/ui/vibe/vibe-data-instrument";

// 金额始终按十进制字符串格式化，避免大额金额经 Number 转换后丢精度。
function money(value: string): string {
  const [integer, fraction] = decimalToFixed(value, 2).split(".");
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

export function SourceInvestmentPerformance({ history, sourceId, sourceName, records, observations, source, manualRecords, currentDay, preset, customRange, showSensitiveInfo, rangeControls, onEdit, onDelete }: {
  history: SourceInvestmentHistory | null;
  sourceId: string;
  sourceName: string;
  records: SourceInvestmentRecord[];
  observations: DailyAssetTrendObservation[];
  source?: ValuationSource;
  manualRecords: ManualAssetRecord[];
  currentDay: string;
  preset: InvestmentPerformanceIntervalPreset;
  customRange: InvestmentPerformanceCustomRange | null;
  showSensitiveInfo: boolean;
  rangeControls?: ReactNode;
  onEdit(record: SourceInvestmentRecord): void;
  onDelete(record: SourceInvestmentRecord): void;
}) {
  const [curve, setCurve] = useState<"return" | "profit">("return");
  const analysis = useMemo(() => analyzeSourceInvestmentAccount({history, sourceId, records, observations, source, manualRecords, currentDay}), [history, sourceId, records, observations, source, manualRecords, currentDay]);
  const days = rangeDays(preset, currentDay, analysis.opening?.day, customRange);
  const byDay = new Map(analysis.points.map(point => [point.day, point]));
  const firstObservation = analysis.points[0]?.day;
  const points = days.filter(day => !firstObservation || day >= firstObservation).map(day => {
    const point = byDay.get(day);
    const value = curve === "profit" ? point?.profit ?? null : point?.returnRatio == null ? null : decimalMultiply(point.returnRatio, "100");
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
      <p>{sourceName}独立账户{analysis.currency ? ` · ${analysis.currency}` : ""} · {showSensitiveInfo ? current ? `截至 ${current.day}` : "暂无收益记录" : "金额及趋势已隐藏"}</p>
    </header>
    <div className="source-performance__metrics">
      {metrics.map(metric => <article key={metric.label}>
        <p className="card-label">{metric.label}</p>
        <VibeMetric animate={false} className={showSensitiveInfo && metric.amount === null ? "source-performance__unavailable" : undefined} unit={metric.unit} value={!showSensitiveInfo ? "••••••" : metric.amount === null ? "数据不足" : money(metric.amount)} />
      </article>)}
    </div>
    <div className="source-performance__chart-toolbar">
      <div className="source-performance__curve-options" role="group" aria-label="收益曲线类型">
        <VibeButton type="button" variant="text" aria-pressed={curve === "return"} onClick={() => setCurve("return")}>收益率曲线</VibeButton>
        <VibeButton type="button" variant="text" aria-pressed={curve === "profit"} onClick={() => setCurve("profit")}>累计收益曲线</VibeButton>
      </div>
      {rangeControls}
    </div>
    <div className="source-performance__chart-caption">
      <span>{curve === "return" ? "累计资金加权收益率 · %" : `累计收益 · ${analysis.currency ?? "账户原币"}`}</span>
      <span>{curve === "return" ? "Modified Dietz · 不年化" : "资产金额 − 累计净投入"}</span>
    </div>
    {showSensitiveInfo && analysis.missingReason ? <div className="source-performance__empty" role="status"><h4>补全记录查看收益</h4><p>{analysis.missingReason}</p><p>可在上方「手动记录」添加。</p></div> : <AssetTrendChart
      ariaLabel={`${sourceName}${curve === "return" ? "收益率曲线" : "累计收益曲线"}`}
      currency={curve === "return" ? "%" : analysis.currency ?? "USD"}
      formatAmount={curve === "return" ? value => decimalToFixed(value, 2) : money}
      formatDay={day => day.slice(2).replaceAll("-", "/")}
      chartHeight={256}
      points={showSensitiveInfo ? points : []}
      isSensitiveHidden={!showSensitiveInfo}
      incompleteCount={0}
      unavailableCount={0}
      variant="source"
    />}
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
        {records.toSorted((a,b)=>b.day.localeCompare(a.day)||b.recordedAt.localeCompare(a.recordedAt)).map(record=><li key={record.id}>
          <span>{record.day}</span><span>{{opening:"期初本金",deposit:"投入",withdrawal:"取出",valuation:"当天资产金额"}[record.kind]}</span>
          <strong>{money(record.amount)} {record.currency}</strong>
          <div className="source-performance__record-actions">
            <VibeButton type="button" variant="text" onClick={()=>onEdit(record)} aria-label={`编辑 ${record.day} ${record.amount} ${record.currency} 记录`}>编辑</VibeButton>
            <VibeButton type="button" variant="text" onClick={()=>onDelete(record)} aria-label={`删除 ${record.day} ${record.amount} ${record.currency} 记录`}>删除</VibeButton>
          </div>
        </li>)}
      </ol>
    </details> : null}
    {showSensitiveInfo && history ? <details className="daily-trend-details">
      <summary>导入记账记录（{history.records.length} 条）</summary>
      <p className="trend-note">{history.accountName} · 期初本金 {history.openingInvestment.day}：{money(history.openingInvestment.amount)} {history.currency}。{history.openingBasis}。</p>
      <ol className="manual-asset-history-list">
        {history.records.toReversed().map(record => <li key={record.id}>
          <span>{record.day}</span>
          <span>{record.kind === "valuation" ? "当天资产金额" : record.kind === "deposit" ? "投入" : "取出"}</span>
          <strong>{money(record.amount)} {history.currency}</strong>
        </li>)}
      </ol>
    </details> : null}
    </div>
  </section>;
}
