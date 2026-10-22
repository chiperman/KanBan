"use client";

import { formatAssetAmount } from "@/ui/asset-price-display";
import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { activeBookRecords, analyzeInvestmentBook, bookHistoryPrefix, INVESTMENT_BOOKS, investmentBook, type BookMember, type BookRecord, type InvestmentBookId, type InvestmentBookState } from "@/domain/investment-books";
import { decimalCompare, decimalMultiply } from "@/domain/decimal";
import { shanghaiDay } from "@/domain/daily-asset-snapshots";
import { parseSourceInvestmentHistory } from "@/domain/source-investment-history";
import { rangeDays } from "@/domain/investment-performance-trend";
import type { AssetSourceSummary, DailyAssetTrendObservation, InvestmentCashflow, ManualAssetRecord } from "@/server/ports";
import { assetSourceDisplayName } from "@/domain/asset-source-display-name";
import { AssetTrendPanel, useAssetTrendRange } from "@/ui/asset-trend-panel";
import { formatShanghaiDayLabel, formatShanghaiFullDayLabel } from "@/ui/shanghai-date-time";
import { DEFAULT_MARKET_BENCHMARK_SYMBOLS, type MarketBenchmarkSymbol } from "@/domain/market-benchmark";
import { useInvestmentBookBenchmarkComparison } from "@/ui/market-benchmark";
import { MarketBenchmarkControls } from "@/ui/market-benchmark-controls";
import { AssetGlobalRefreshControl } from "@/ui/asset-refresh-controls";
import { LongbridgeRealtimeNotice } from "@/ui/longbridge-realtime-notice";
import { useLongbridgeRealtime } from "@/ui/use-longbridge-realtime";
import { useWorkbenchDisplayPreferences } from "@/ui/workbench-display-preferences";
import { lockOnUnauthorizedResponse, OWNER_SESSION_EXPIRED_MESSAGE, readJsonResult } from "@/ui/owner-request-lock";
import { WorkspaceViewNavigation } from "@/ui/workspace-view-navigation";
import { WorkbenchPageHeader } from "@/ui/workbench-page-header";
import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
import { VibeEntityLink } from "@/ui/vibe/vibe-entity-link";
import { VibeMetric } from "@/ui/vibe/vibe-data-instrument";
import { VibeDialog } from "@/ui/vibe/vibe-dialog";
import { VibeField, VibeSelectField, VibeTextAreaField } from "@/ui/vibe/vibe-field";
import { VibeDateField } from "@/ui/vibe/vibe-date-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";

export type InvestmentBookSource = Omit<AssetSourceSummary, "credentialReference" | "permissions">;
const labels = { opening: "期初本金", deposit: "入金", withdrawal: "出金", valuation: "资产金额" };
export function bookMoney(value: string): string {
  return formatAssetAmount(value);
}
async function bookRequest(body: object) {
  const response = await fetch("/api/investment-books", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await readJsonResult<{ error?: string }>(response);
  if (lockOnUnauthorizedResponse(response)) throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
  if (!response.ok) throw new Error(result?.error ?? "账本保存失败");
}
function ActionDialog({ title, description, children, submit, onClose, disabled = false, button = "保存" }: {
  title: string; description: string; children: ReactNode; submit(): Promise<void>; onClose(): void; disabled?: boolean; button?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setPending(true); setError("");
    try { await submit(); router.refresh(); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : "保存失败"); }
    finally { setPending(false); }
  }
  return <VibeDialog title={title} titleId="book-action-title" description={description} onClose={() => { if (!pending) onClose(); }} onSubmit={e => { e.preventDefault(); if (!pending) void save(); }}
    actions={<><VibeButton type="button" variant="text" disabled={pending} onClick={onClose}>取消</VibeButton><VibeButton type="submit" variant="primary" disabled={pending || disabled}>{pending ? "保存中…" : button}</VibeButton></>}>
    <fieldset className="investment-books__fields" disabled={pending}>{children}</fieldset>
    {error ? <VibeNotice tone="error" role="alert">{error}</VibeNotice> : null}
  </VibeDialog>;
}
function FundDialog({ initialBookId, currentDay, state, record, onClose }: { initialBookId: InvestmentBookId; currentDay: string; state: InvestmentBookState; record?: BookRecord; onClose(): void }) {
  const [bookId, setBookId] = useState(initialBookId);
  const [id] = useState(() => crypto.randomUUID());
  const [kind, setKind] = useState<BookRecord["kind"]>(record?.kind ?? "deposit");
  const [day, setDay] = useState(record?.day ?? currentDay);
  const [amount, setAmount] = useState(record?.amount ?? "");
  const [note, setNote] = useState(record?.note ?? "");
  const book = investmentBook(bookId);
  const hasOpening = activeBookRecords(state, bookId).some(row => row.kind === "opening");
  return <ActionDialog title={record ? "更正记账记录" : "记录资金"} description={record ? "更正后重算收益，原记录保留，可在原件与更正记录中查看。" : "选择账本，记录实际从投资范围外转入或转出的资金。"} onClose={onClose} disabled={!amount.trim()} submit={() => bookRequest({ action: "save", bookId, record: { id, day, amount, currency: book.currency, kind, note, ...(record ? { replacesId: record.id } : {}) } })}>
    <VibeSelectField fieldId="book-fund-book" label="账本" value={bookId} disabled={!!record} options={INVESTMENT_BOOKS.map(book => ({ value: book.id, label: `${book.name} · ${book.currency}` }))} onValueChange={value => { setBookId(value as InvestmentBookId); setKind("deposit"); }} />
    <VibeSelectField fieldId="book-fund-kind" label="记录类型" value={kind} disabled={!!record} onValueChange={value => setKind(value as typeof kind)} options={Object.entries(labels).filter(([key]) => record ? key === record.kind : key !== "valuation" && (key !== "opening" || !hasOpening)).map(([value, label]) => ({ value, label }))} />
    <VibeDateField fieldId="book-fund-day" label="发生日期" max={currentDay} value={day} onValueChange={setDay} />
    <VibeField fieldId="book-fund-amount" label={`${labels[kind]} · ${book.currency}`} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />
    <VibeField fieldId="book-fund-note" label="备注" maxLength={1000} value={note} onChange={e => setNote(e.target.value)} />
    <p className="trend-note">{kind === "opening" ? "填写历史起点时累计投入的本金，不是今天的资产余额；从零开始填 0。之后的入金出金要逐笔补齐，收益率从这个日期开始计算。" : kind === "valuation" ? "更正这一天的历史总资产，不改变本金。" : "资金记录不改变资产余额。买卖、分红和同一本账内账户互转都不属于入金出金。"}</p>
    {bookId === "crypto" ? <p className="trend-note">虚拟货币按整体记账，无需选择交易所或钱包，不分摊历史本金。</p> : null}
  </ActionDialog>;
}
function AssetDialog({ currentDay, initialDay, state, sources, manualRecords, onClose }: { currentDay: string; initialDay?: string; state: InvestmentBookState; sources: InvestmentBookSource[]; manualRecords: ManualAssetRecord[]; onClose(): void }) {
  const members = state.members.filter(row => row.bookId === "a-shares" && row.confirmed && !row.toDay);
  const [sourceId, setSourceId] = useState(members[0]?.sourceId ?? "");
  const [day, setDay] = useState(initialDay ?? currentDay);
  const [amount, setAmount] = useState(() => initialDay ? manualRecords.find(row => row.sourceId === members[0]?.sourceId && row.day === initialDay)?.amount ?? "" : "");
  return <ActionDialog title="更新A股资产" description="每周日填写当天的资产总额，包含持仓和账户现金。同日保存会更新已有金额。" onClose={onClose} disabled={!sourceId || !amount.trim()} submit={() => bookRequest({ action: "asset", bookId: "a-shares", sourceId, day, amount, currency: "CNY" })}>
    <VibeSelectField fieldId="book-asset-source" label="资产来源" value={sourceId} onValueChange={id => { setSourceId(id); setAmount(manualRecords.find(row => row.sourceId === id && row.day === day)?.amount ?? ""); }} options={members.map(row => ({ value: row.sourceId, label: sources.find(source => source.id === row.sourceId)?.label ?? row.sourceId }))} />
    <VibeDateField fieldId="book-asset-day" label="资产日期" max={currentDay} value={day} onValueChange={setDay} />
    <VibeField fieldId="book-asset-amount" label="当天资产总额 · CNY" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />
    {members.length === 0 ? <VibeNotice tone="info">请先在账户与来源接入手工证券来源，并在本页确认来源范围。</VibeNotice> : null}
    <p className="trend-note">此处只更新资产金额。新增投入或取出资金，请另记入金或出金。</p>
  </ActionDialog>;
}
function ImportDialog({ bookId, onClose }: { bookId: InvestmentBookId; onClose(): void }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ReturnType<typeof parseSourceInvestmentHistory> | null>(null);
  const [error, setError] = useState("");
  function inspect() {
    try { const history = parseSourceInvestmentHistory(JSON.parse(text)); if (history.currency !== investmentBook(bookId).currency) throw new Error("币种与本账不一致"); setPreview(history); setError(""); }
    catch (e) { setPreview(null); setError(e instanceof Error ? e.message : "导入格式无效"); }
  }
  return <ActionDialog title={`导入历史 · ${investmentBook(bookId).name}`} description="导入已有的投资账本 JSON。先核对截止日、本金和资产；重复导入同一原件不会重复计账。" onClose={onClose} disabled={!preview} button="确认导入" submit={() => bookRequest({ action: "import", bookId, history: preview })}>
    <VibeTextAreaField fieldId="book-import-json" label="历史数据 JSON" value={text} onChange={e => { setText(e.target.value); setPreview(null); }} rows={6} />
    <VibeButton type="button" variant="outline" onClick={inspect}>核对导入数据</VibeButton>
    {error ? <VibeNotice tone="error" role="alert">{error}</VibeNotice> : null}
    {preview ? <VibeNotice tone="info">{preview.accountName} · {preview.records.length} 条 · 截至 {preview.reconciliation.asOf}<br />净投入 {bookMoney(preview.reconciliation.netInvestment)} / 资产 {bookMoney(preview.reconciliation.total)} / 收益 {bookMoney(preview.reconciliation.profit)} {preview.currency}</VibeNotice> : null}
    <p className="trend-note">历史总额与后续同步按截止日衔接，不叠加。发现原件被改写、缺失或账本冲突时会拒绝导入。</p>
  </ActionDialog>;
}
function MemberDialog({ member, currentDay, onClose }: { member: BookMember; currentDay: string; onClose(): void }) {
  const [fromDay, setFromDay] = useState(member.fromDay ?? "");
  const [toDay, setToDay] = useState(member.toDay ?? "");
  return <ActionDialog title="确认来源范围" description="接入接口不会被算成新增投资。请确认该账户从哪天起包含在整本账的资产总额里。" onClose={onClose} disabled={!fromDay} submit={() => bookRequest({ action: "member", bookId: member.bookId, sourceId: member.sourceId, fromDay, toDay: toDay || null })}>
    <VibeDateField fieldId="book-member-from" label="计入资产的起始日" max={currentDay} value={fromDay} onValueChange={setFromDay} />
    <VibeDateField fieldId="book-member-to" label="退出日（可空，当天起不再计入）" max={currentDay} value={toDay} onValueChange={setToDay} />
    <p className="trend-note">{member.fromDay === null ? "现有来源此前默认全程计入；保存后将按指定起始日重新核算自动汇总。" : "确认前暂停汇总，避免接入账户导致资产跳变被误认为收益。"} 导入历史的整本账总额保持原口径。</p>
  </ActionDialog>;
}
function ResolveDialog({ flow, bookId, state, onClose }: { flow: InvestmentCashflow; bookId: InvestmentBookId; state: InvestmentBookState; onClose(): void }) {
  const [target, setTarget] = useState(bookId);
  const [recordId, setRecordId] = useState("");
  const matching = activeBookRecords(state, target).filter(row => row.day === shanghaiDay(flow.occurredAt) && row.currency === flow.currency && decimalCompare(row.amount, flow.amount) === 0 && (flow.kind === "initial-investment" ? row.kind === "opening" || row.kind === "deposit" : row.kind === (flow.kind === "external-withdrawal" ? "withdrawal" : "deposit")));
  return <ActionDialog title="确认旧资金记录归属" description={`${shanghaiDay(flow.occurredAt)} · ${flow.amount} ${flow.currency} · ${flow.note ?? "无备注"}`} onClose={onClose} submit={() => bookRequest({ action: "resolve", bookId: target, cashflowId: flow.id, recordId: recordId || null })}>
    <VibeSelectField fieldId="book-resolve-target" label="归属账本" value={target} onValueChange={value => { setTarget(value as InvestmentBookId); setRecordId(""); }} options={INVESTMENT_BOOKS.map(book => ({ value: book.id, label: book.name }))} />
    <VibeSelectField fieldId="book-resolve-record" label="计账方式" value={recordId} onValueChange={setRecordId} options={[{ value: "", label: "作为一笔独立资金计入" }, ...matching.map(row => ({ value: row.id, label: `关联已有 ${row.day} ${labels[row.kind]} ${row.amount}，只计一次` }))]} />
    <p className="trend-note">确认这笔资金是否已包含在导入历史内。原始记录始终保留。</p>
  </ActionDialog>;
}

export function InvestmentBooksWorkspace({ state, initialBookId = "us-stocks", view = "performance", sources, observations, manualRecords, cashflows, currentDay }: {
  state: InvestmentBookState; initialBookId?: InvestmentBookId; view?: "performance" | "records" | "manage"; sources: InvestmentBookSource[]; observations: DailyAssetTrendObservation[]; manualRecords: ManualAssetRecord[]; cashflows: InvestmentCashflow[]; currentDay: string;
}) {
  const bookId = initialBookId;
  const [recordFilter, setRecordFilter] = useState<"all" | "funds" | "valuations">("all");
  const [recordPage, setRecordPage] = useState(1);
  const [curve, setCurve] = useState<"return" | "profit" | "total">("return");
  const [enabledSymbols, setEnabledSymbols] = useState<MarketBenchmarkSymbol[]>([...DEFAULT_MARKET_BENCHMARK_SYMBOLS]);
  const trendRange = useAssetTrendRange();
  const [dialog, setDialog] = useState<"fund" | "asset" | "import" | null>(null);
  const [assetDay, setAssetDay] = useState<string | undefined>();
  const [editing, setEditing] = useState<BookRecord | null>(null);
  const [voiding, setVoiding] = useState<BookRecord | null>(null);
  const [member, setMember] = useState<BookMember | null>(null);
  const [resolving, setResolving] = useState<InvestmentCashflow | null>(null);
  const { showSensitiveInfo } = useWorkbenchDisplayPreferences();
  const { liveSources, state: realtimeState, retry } = useLongbridgeRealtime(sources);
  const analysis = useMemo(() => analyzeInvestmentBook({ state, bookId, sources: liveSources, observations, manualRecords, currentDay }), [state, bookId, liveSources, observations, manualRecords, currentDay]);
  const current = analysis.current;
  const pointMap = new Map(analysis.points.map(row => [row.day, row]));
  const days = rangeDays(trendRange.preset, currentDay, analysis.points[0]?.day, trendRange.customRange);
  const selectedDays = new Set(days);
  const benchmarkVisible = view === "performance" && curve === "return" && showSensitiveInfo;
  const benchmarkDataState = useInvestmentBookBenchmarkComparison({
    enabledSymbols,
    points: analysis.points.filter(point => selectedDays.has(point.day)),
    records: analysis.records,
    sources: liveSources,
    visible: benchmarkVisible,
  });
  const points = days.filter(day => day >= (analysis.points[0]?.day ?? currentDay)).map(day => {
    const row = pointMap.get(day);
    const amount = curve === "total" ? row?.total ?? null : curve === "profit" ? row?.profit ?? null : row?.returnRatio == null ? null : decimalMultiply(row.returnRatio, "100");
    return { day, amount, observed: !!row, status: amount == null ? "incomplete" as const : "complete" as const };
  });
  const timeline = [
    ...analysis.points.map(point => ({ key: `asset:${point.day}`, day: point.day, label: "资产金额", kind: "valuation" as const, amount: point.total, basis: point.basis, record: analysis.records.find(row => row.kind === "valuation" && row.day === point.day) })),
    ...analysis.records.filter(row => row.kind !== "valuation").map(row => ({ key: row.id, day: row.day, label: labels[row.kind], kind: row.kind, amount: row.amount, basis: row.origin === "import" ? "导入历史" : row.origin === "legacy" ? "旧资金原件" : "手动记录", record: row })),
  ].toSorted((a, b) => b.day.localeCompare(a.day) || a.key.localeCompare(b.key));
  const filteredTimeline = timeline.filter(row => recordFilter === "all" || (recordFilter === "valuations" ? row.kind === "valuation" : row.kind !== "valuation"));
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(filteredTimeline.length / pageSize));
  const currentPage = Math.min(recordPage, pageCount);
  const visibleTimeline = filteredTimeline.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const pendingMembers = analysis.members.filter(row => !row.confirmed);
  const unassignedCashflows = cashflows.filter(flow => state.unassignedLegacyIds.includes(flow.id));
  const bookHref = (id: InvestmentBookId, section = view) => `/performance?book=${id}&view=${section}`;
  const metrics = [
    { label: "资产总额", value: current?.total ?? null, unit: analysis.book.currency },
    { label: "累计净投入", value: current?.netInvestment ?? null, unit: analysis.book.currency },
    { label: "累计收益", value: current?.profit ?? null, unit: analysis.book.currency },
    { label: "累计收益率", value: current?.returnRatio == null ? null : decimalMultiply(current.returnRatio, "100"), unit: "%" },
  ];
  return <div className="investment-books">
    <WorkbenchPageHeader eyebrow="INVESTMENT / BOOKS" title="投资账本" description="三本账统一记录资金，资产金额由同步或手动更新。" actions={<><AssetGlobalRefreshControl /><VibeButton type="button" variant="primary" onClick={() => setDialog("fund")}>记录资金</VibeButton>{bookId === "a-shares" ? <VibeButton type="button" variant="outline" onClick={() => setDialog("asset")}>更新A股资产</VibeButton> : null}</>} />
    <WorkspaceViewNavigation label="选择投资账本" current={bookHref(bookId)} items={INVESTMENT_BOOKS.map(book => ({ href: bookHref(book.id), label: `${book.name} · ${book.currency}` }))} />
    <WorkspaceViewNavigation label="账本视角" current={bookHref(bookId)} items={[
      { href: bookHref(bookId, "performance"), label: "收益表现" },
      { href: bookHref(bookId, "records"), label: "记账记录" },
      { href: bookHref(bookId, "manage"), label: "账本管理" },
    ]} />
    {pendingMembers.length > 0 || state.unassignedLegacyIds.length > 0 ? <div className="investment-books__pending">
    {pendingMembers.length > 0 ? <section className="investment-books__pending-card" aria-label="待确认来源范围">
      <h2>来源范围待确认</h2><p className="trend-note">确认加入日期后才能汇总自动资产，避免将账户接入误算为收益。</p>
      <ul className="manual-asset-history-list">{pendingMembers.map(row => <li key={row.sourceId}>
        <span>{sources.find(source => source.id === row.sourceId) ? assetSourceDisplayName(sources.find(source => source.id === row.sourceId)!) : "已移除来源"}</span>
        <VibeButton type="button" variant="outline" size="compact" onClick={() => setMember(row)}>确认范围</VibeButton>
      </li>)}</ul>
    </section> : null}
    {state.unassignedLegacyIds.length > 0 ? <section className="investment-books__pending-card" aria-label="旧资金待核对">
      <h2>旧资金待核对</h2><p className="trend-note">有 {state.unassignedLegacyIds.length} 笔旧资金需要确认归属，确认前暂停收益计算。</p>
      <ul className="manual-asset-history-list">{unassignedCashflows.map(flow => <li key={flow.id}>
        <span>{shanghaiDay(flow.occurredAt)}</span><strong>{showSensitiveInfo ? `${bookMoney(flow.amount)} ${flow.currency}` : "••••••"}</strong>
        <VibeButton type="button" size="compact" variant="outline" onClick={() => setResolving(flow)}>核对归属</VibeButton>
      </li>)}</ul>
    </section> : null}
    </div> : null}
    <LongbridgeRealtimeNotice state={realtimeState} retry={retry} />
    {view === "performance" ? <section className="source-performance" aria-label={`${analysis.book.name}投资表现`}>
      <header className="source-performance__heading"><h2>{analysis.book.name}</h2><p>{analysis.book.automatic ? "资产自动同步" : "资产手动更新"} · {current ? `截至 ${current.day}` : "暂无资产记录"}{state.historyThroughDay[bookId] ? ` · 历史截止 ${state.historyThroughDay[bookId]}` : ""}</p></header>
      <div className="source-performance__metrics investment-books__metrics">{metrics.map(metric => <article key={metric.label}><p className="card-label">{metric.label}</p><VibeMetric animate={false} value={!showSensitiveInfo ? "••••••" : metric.value == null ? "数据不足" : bookMoney(metric.value)} unit={metric.unit} /></article>)}</div>
      {showSensitiveInfo && analysis.missingReason ? <VibeNotice tone="info" role="status">{analysis.missingReason}</VibeNotice> : null}
      {showSensitiveInfo && analysis.historyComparison ? <VibeNotice tone="info" role="status">历史与同步金额待核对：{analysis.historyComparison.day} 历史总额 {bookMoney(analysis.historyComparison.historicalTotal)}，自动汇总 {bookMoney(analysis.historyComparison.automaticTotal)}，相差 {bookMoney(analysis.historyComparison.difference)} {analysis.book.currency}。请核对采集时间和来源范围。历史截止日及以前采用历史总额，之后接自动汇总；差额不会补成入金，两份金额不会相加。</VibeNotice> : null}
      <AssetTrendPanel
        benchmark={benchmarkVisible && enabledSymbols.length > 0 && benchmarkDataState.kind === "ready" && benchmarkDataState.comparison.reason === null ? {
          assetScopeLabel: analysis.book.name,
          comparison: benchmarkDataState.comparison,
          enabledSymbols,
          returnComparison: true,
        } : null}
        range={{ ...trendRange, currentDay, firstDay: analysis.points[0]?.day }}
        metricControls={<div className="source-performance__curve-options" role="group" aria-label="趋势指标">
          {(["total", "profit", "return"] as const).map(value => <VibeButton key={value} type="button" variant={curve === value ? "primary" : "outline"} size="compact" aria-pressed={curve === value} onClick={() => setCurve(value)}>{value === "total" ? "资产总额" : value === "profit" ? "累计收益" : "收益率"}</VibeButton>)}
        </div>}
        ariaLabel={`${analysis.book.name}${curve === "return" ? "收益率曲线" : curve === "profit" ? "累计收益曲线" : "资产总额趋势"}`}
        currency={curve === "return" ? "%" : analysis.book.currency}
        formatAmount={bookMoney}
        formatDay={formatShanghaiDayLabel}
        chartHeight={256}
        points={points}
        isSensitiveHidden={!showSensitiveInfo}
        variant="source"
      >
        {benchmarkVisible ? <MarketBenchmarkControls
          assetScopeLabel={analysis.book.name}
          dataState={benchmarkDataState}
          enabledSymbols={enabledSymbols}
          formatDay={formatShanghaiFullDayLabel}
          onEnabledSymbolsChange={setEnabledSymbols}
          returnComparison
        /> : null}
      </AssetTrendPanel>
      <details className="daily-trend-details"><summary>计算口径</summary><div className="daily-trend-details-content"><p>累计收益 = 资产总额 − 期初本金 − 累计入金 + 累计出金。指标与本金均截至上方资产日期。</p><p>收益率使用 Modified Dietz 按资金发生日期加权，为记账以来累计收益率，不年化。切换区间只筛选曲线，不重置本金。</p><p>导入历史截止日及以前采用历史整本账总额，之后采用同步或手动资产记录；同一天只计一个总额。缺少资产或汇率时留空。</p><p>虚拟货币合并交易所、钱包和手动补充来源。账内互转不增加本金；三本账之间转账需分别记录一笔出金、一笔入金。</p></div></details>
    </section> : null}
    {view === "records" ? <section className="source-performance" aria-label="统一记账记录"><header className="investment-books__section-heading"><div><h2>记账记录</h2><p className="trend-note">历史和新记录按日期排列，入金出金独立列出。资产同日仅展示生效总额。</p></div><VibeLink href={bookHref(bookId, "manage")} variant="text">历史导入与审计</VibeLink></header>
      <div className="investment-books__record-filters" role="group" aria-label="记账记录类型">
        {([ ["all", "全部记录"], ["funds", "资金记录"], ["valuations", "资产估值"] ] as const).map(([value, label]) => <VibeButton key={value} type="button" size="compact" aria-pressed={recordFilter === value} variant={recordFilter === value ? "primary" : "outline"} onClick={() => { setRecordFilter(value); setRecordPage(1); }}>{label}</VibeButton>)}
      </div>
      {showSensitiveInfo && filteredTimeline.length === 0 ? <p className="trend-note">暂无{recordFilter === "funds" ? "资金" : recordFilter === "valuations" ? "资产估值" : "记账"}记录。</p> : null}
      {showSensitiveInfo ? <ol className="manual-asset-history-list investment-books__record-list">{visibleTimeline.map(row => <li key={row.key}><span>{row.day}</span><span>{row.label}<small className="investment-books__basis">{row.basis}</small></span><strong>{row.amount == null ? "数据不足" : `${bookMoney(row.amount)} ${analysis.book.currency}`}</strong>{row.record ? <div className="source-performance__record-actions"><VibeButton type="button" variant="text" size="compact" onClick={() => setEditing(row.record!)} aria-label={`更正 ${row.day} ${row.label}`}>更正</VibeButton><VibeButton type="button" variant="text" size="compact" tone="danger" onClick={() => setVoiding(row.record!)} aria-label={`作废 ${row.day} ${row.label}`}>作废</VibeButton></div> : row.basis === "手动资产金额" ? <VibeButton type="button" variant="text" size="compact" onClick={() => { setAssetDay(row.day); setDialog("asset"); }}>更新资产</VibeButton> : null}</li>)}</ol> : <p className="trend-note">金额及记录已隐藏。</p>}
      {showSensitiveInfo && filteredTimeline.length > 0 ? <nav aria-label="记账记录分页" className="investment-books__pagination">
        <VibeButton type="button" variant="outline" disabled={currentPage === 1} onClick={() => setRecordPage(currentPage - 1)}>上一页</VibeButton>
        <span role="status">第 {currentPage} / {pageCount} 页 · 共 {filteredTimeline.length} 条</span>
        <VibeButton type="button" variant="outline" disabled={currentPage === pageCount} onClick={() => setRecordPage(currentPage + 1)}>下一页</VibeButton>
      </nav> : null}
    </section> : null}
    {view === "manage" ? <>
    <section className="source-performance" aria-label="历史导入"><header className="investment-books__section-heading"><div><h2>历史导入</h2><p className="trend-note">先预览截止日、本金和资产金额，再确认导入。</p></div><VibeButton type="button" variant="outline" onClick={() => setDialog("import")}>导入历史</VibeButton></header></section>
    <section className="source-performance" aria-label="账本来源"><h2>资产来源</h2><p className="trend-note">这里只汇总资产余额，不给账户分摊历史本金。自动同步沿用已有刷新机制。</p><ul className="manual-asset-history-list investment-books__member-list">{analysis.members.map(row => { const source = sources.find(source => source.id === row.sourceId); return <li key={row.sourceId}><div>{source ? <VibeEntityLink href={`/asset-sources/${encodeURIComponent(source.id)}`} aria-label={`查看 ${assetSourceDisplayName(source)} 来源详情`}>{assetSourceDisplayName(source)}</VibeEntityLink> : "已移除来源"}</div><span>{row.confirmed ? `${row.fromDay ?? "已有历史起点"} 起${row.toDay ? `，${row.toDay} 退出` : ""}` : "待确认加入日期"}</span><VibeButton type="button" size="compact" variant="outline" onClick={() => setMember(row)}>确认范围</VibeButton></li>; })}</ul></section>
    <details className="daily-trend-details"><summary>原件与更正记录</summary>{showSensitiveInfo ? <div className="daily-trend-details-content"><p>保留 {state.imports.filter(history => state.records.some(row => row.bookId === bookId && row.originKey.startsWith(`${bookHistoryPrefix(history)}:`))).length} 份导入原件；{state.legacyLinks.filter(link => state.records.some(row => row.id === link.recordId && row.bookId === bookId)).length} 笔旧资金已关联，仅计算一次。</p><ol className="manual-asset-history-list">{state.records.filter(row => row.bookId === bookId && (row.voidedAt || row.replacesId)).map(row => <li key={row.id}><span>{row.day}</span><span>{labels[row.kind]} · {row.voidedAt ? "已作废 / 更正前" : "更正后"}</span><strong>{bookMoney(row.amount)} {row.currency}</strong></li>)}</ol></div> : <p>记录已隐藏。</p>}</details>
    </> : null}
    {dialog === "fund" || editing ? <FundDialog initialBookId={bookId} state={state} currentDay={currentDay} record={editing ?? undefined} onClose={() => { setDialog(null); setEditing(null); }} /> : null}
    {dialog === "asset" ? <AssetDialog state={state} sources={sources} manualRecords={manualRecords} currentDay={currentDay} initialDay={assetDay} onClose={() => { setDialog(null); setAssetDay(undefined); }} /> : null}
    {dialog === "import" ? <ImportDialog bookId={bookId} onClose={() => setDialog(null)} /> : null}
    {member ? <MemberDialog member={member} currentDay={currentDay} onClose={() => setMember(null)} /> : null}
    {resolving ? <ResolveDialog flow={resolving} bookId={bookId} state={state} onClose={() => setResolving(null)} /> : null}
    {voiding ? <ActionDialog title="作废这条记录？" description={`${voiding.day} · ${labels[voiding.kind]} · ${voiding.amount} ${voiding.currency}。作废后重算收益，原件保留。`} button="确认作废" onClose={() => setVoiding(null)} submit={() => bookRequest({ action: "void", bookId, id: voiding.id, confirmation: "VOID_RECORD" })} >{voiding.kind === "opening" ? <p>作废期初本金后，需补齐起点才能重新计算收益。</p> : null}</ActionDialog> : null}
  </div>;
}
