"use client";

import { formatAssetAmount } from "@/ui/asset-price-display";
import { AssetFinancialValue } from "@/ui/asset-financial-value";
import { InvestmentBookRecordAmount, longbridgeOriginalFundingAmount } from "@/ui/investment-book-record-amount";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { activeBookRecords, analyzeInvestmentBook, analyzeInvestmentBookInterval, INVESTMENT_BOOKS, investmentBook, type BookMember, type BookRecord, type InvestmentBookId, type InvestmentBookState } from "@/domain/investment-books";
import { decimalAdd, decimalCompare, decimalMultiply } from "@/domain/decimal";
import { shanghaiDay } from "@/domain/daily-asset-snapshots";
import { parseSourceInvestmentHistory } from "@/domain/source-investment-history";
import { rangeDays } from "@/domain/investment-performance-trend";
import type { AssetSourceSummary, DailyAssetTrendObservation, InvestmentCashflow, ManualAssetRecord } from "@/server/ports";
import { assetSourceDisplayName } from "@/domain/asset-source-display-name";
import { AssetTrendPanel, AssetTrendRangeControls, useAssetTrendRange } from "@/ui/asset-trend-panel";
import type { AssetTrendEvent } from "@/ui/asset-trend-chart";
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
import { VibeMetric } from "@/ui/vibe/vibe-data-instrument";
import { VibeDialog } from "@/ui/vibe/vibe-dialog";
import { VibeField, VibeSelectField, VibeTextAreaField } from "@/ui/vibe/vibe-field";
import { VibeDateField } from "@/ui/vibe/vibe-date-field";
import { VibeAmountField } from "@/ui/vibe/vibe-amount-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { useTablePagination, VibeTablePagination } from "@/ui/vibe/vibe-table-pagination";
import { ManualAssetRecordCheck } from "@/ui/source-investment-record-dialog";

export type InvestmentBookSource = Omit<AssetSourceSummary, "credentialReference" | "permissions">;
const labels = { opening: "期初本金", deposit: "入金", withdrawal: "出金", valuation: "资产金额" };
export function bookMoney(value: string): string {
  return formatAssetAmount(value);
}
class BookSaveOutcomeUnknown extends Error {
  constructor() { super("尚未确认保存结果。请在新标签页核对最新记录，确认未保存后再重试；当前输入已保留。"); }
}
async function bookRequest(body: object) {
  let response: Response;
  try {
    response = await fetch("/api/investment-books", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch { throw new BookSaveOutcomeUnknown(); }
  if (lockOnUnauthorizedResponse(response)) throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
  const result = await readJsonResult<{ ok?: boolean; error?: string }>(response);
  if (response.status >= 500 || (response.ok && result?.ok !== true)) throw new BookSaveOutcomeUnknown();
  if (!response.ok) throw new Error(result?.error ?? "账本保存失败");
}
function ActionDialog({ title, description, children, submit, onClose, checkBookId, checkHref, disabled = false, dirty = false, button = "保存" }: {
  title: string; description?: ReactNode; children: ReactNode; submit(): Promise<void>; onClose(): void; checkBookId: InvestmentBookId; checkHref?: string; disabled?: boolean; dirty?: boolean; button?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState("");
  const [needsCheck, setNeedsCheck] = useState(false);
  const needsCheckRef = useRef(false);
  async function save() {
    if (pendingRef.current || needsCheckRef.current || disabled) return;
    pendingRef.current = true;
    setPending(true); setError("");
    try { await submit(); router.refresh(); onClose(); }
    catch (e) {
      if (e instanceof BookSaveOutcomeUnknown) { needsCheckRef.current = true; setNeedsCheck(true); }
      setError(e instanceof Error ? e.message : "保存失败");
    }
    finally { pendingRef.current = false; setPending(false); }
  }
  return <VibeDialog title={title} titleId="book-action-title" description={description} dirty={dirty || needsCheck} pending={pending} onClose={onClose} onSubmit={e => { e.preventDefault(); void save(); }}
    actions={requestClose => <><VibeButton type="button" variant="text" disabled={pending} onClick={requestClose}>取消</VibeButton>{needsCheck ? <>
      <VibeLink href={checkHref ?? `/performance?book=${checkBookId}&view=records&recordFilter=all`} target="_blank" rel="noreferrer" variant="outline">查看最新记录（新标签页）</VibeLink>
      <VibeButton type="button" variant="text" onClick={() => { needsCheckRef.current = false; setNeedsCheck(false); setError(""); }}>已确认未保存，继续编辑</VibeButton>
    </> : <VibeButton type="submit" variant="primary" disabled={pending || disabled}>{pending ? "保存中…" : button}</VibeButton>}</>}>
    <fieldset className="investment-books__fields" disabled={pending || needsCheck}>{children}</fieldset>
    {error ? <VibeNotice tone={needsCheck ? "warning" : "error"} role="alert">{error}</VibeNotice> : null}
  </VibeDialog>;
}
function FundDialog({ initialBookId, currentDay, state, record, onClose }: { initialBookId: InvestmentBookId; currentDay: string; state: InvestmentBookState; record?: BookRecord; onClose(): void }) {
  const [bookId, setBookId] = useState(initialBookId);
  const [id] = useState(() => crypto.randomUUID());
  const [kind, setKind] = useState<BookRecord["kind"]>(record?.kind ?? "deposit");
  const [day, setDay] = useState(record?.day ?? currentDay);
  const [amount, setAmount] = useState(record?.amount ?? "");
  const [note, setNote] = useState(record?.note ?? "");
  const [initial] = useState(() => ({ bookId: initialBookId, kind, day, amount, note }));
  const dirty = bookId !== initial.bookId || kind !== initial.kind || day !== initial.day || amount !== initial.amount || note !== initial.note;
  const book = investmentBook(bookId);
  const hasOpening = activeBookRecords(state, bookId).some(row => row.kind === "opening");
  return <ActionDialog checkBookId={bookId} checkHref={`/performance?book=${bookId}&view=records&recordFilter=${kind === "valuation" ? "valuations" : "funds"}&recordDay=${encodeURIComponent(day)}`} title={record ? "更正记账记录" : "记录出入金"} description={record ? "更正后重算收益，原记录保留。" : undefined} dirty={dirty} onClose={onClose} submit={() => bookRequest({ action: "save", bookId, record: { id, day, amount, currency: book.currency, kind, note, ...(record ? { replacesId: record.id } : {}) } })}>
    <VibeSelectField fieldId="book-fund-book" label="账本" value={bookId} disabled={!!record} options={INVESTMENT_BOOKS.map(book => ({ value: book.id, label: `${book.name}（${book.currency}）` }))} onValueChange={value => { setBookId(value as InvestmentBookId); setKind("deposit"); }} />
    <VibeSelectField fieldId="book-fund-kind" label="记录类型" value={kind} disabled={!!record} onValueChange={value => setKind(value as typeof kind)} options={Object.entries(labels).filter(([key]) => record ? key === record.kind : key !== "valuation" && (key !== "opening" || !hasOpening)).map(([value, label]) => ({ value, label }))} />
    <VibeDateField fieldId="book-fund-day" label="发生日期" max={currentDay} value={day} onValueChange={setDay} />
    <VibeAmountField fieldId="book-fund-amount" label={`${labels[kind]}（${book.currency}）`} kind={kind} value={amount} onValueChange={setAmount} />
    <VibeField fieldId="book-fund-note" label="备注" maxLength={1000} value={note} onChange={e => setNote(e.target.value)} />
    <p className="trend-note">{kind === "opening" ? "填写历史起点时累计投入的本金，不是今天的资产余额；从零开始填 0。之后的入金出金要逐笔补齐，收益率从这个日期开始计算。" : kind === "valuation" ? "更正这一天的历史总资产，不改变本金。" : "资金记录不改变资产余额。买卖、分红和同一本账内账户互转都不属于入金出金。"}</p>
    {bookId === "crypto" ? <p className="trend-note">虚拟货币按整体记账，无需选择交易所或钱包，不分摊历史本金。</p> : null}
  </ActionDialog>;
}
function AssetDialog({ currentDay, initialDay, state, sources, manualRecords, onClose }: { currentDay: string; initialDay?: string; state: InvestmentBookState; sources: InvestmentBookSource[]; manualRecords: ManualAssetRecord[]; onClose(): void }) {
  const members = state.members.filter(row => row.bookId === "a-shares" && row.confirmed && !row.toDay);
  const [sourceId, setSourceId] = useState(members[0]?.sourceId ?? "");
  const [day, setDay] = useState(initialDay ?? currentDay);
  const savedAmount = (id: string, date: string) => manualRecords.find(row => row.sourceId === id && row.day === date)?.amount ?? "";
  const [amount, setAmount] = useState(() => savedAmount(sourceId, day));
  const [originalAmount, setOriginalAmount] = useState(amount);
  const [selection, setSelection] = useState<{ sourceId: string; day: string; focusId: string } | null>(null);
  const dirty = amount !== originalAmount;
  function switchSelection(id: string, date: string) {
    setSourceId(id); setDay(date);
    const saved = savedAmount(id, date);
    setAmount(saved); setOriginalAmount(saved); setSelection(null);
  }
  function requestSelection(id: string, date: string, focusId: string) {
    if (id === sourceId && date === day) return;
    if (dirty) setSelection({ sourceId: id, day: date, focusId });
    else switchSelection(id, date);
  }
  function cancelSelection() {
    const focusId = selection?.focusId;
    setSelection(null);
    window.requestAnimationFrame(() => { if (focusId) document.getElementById(focusId)?.focus(); });
  }
  if (selection) return <VibeDialog title="放弃当前金额修改？" titleId="book-asset-switch-title" description="切换后将显示所选来源与日期已保存的金额。" onClose={cancelSelection} actions={<>
    <VibeButton type="button" variant="text" onClick={cancelSelection}>继续编辑</VibeButton>
    <VibeButton type="button" tone="danger" onClick={() => switchSelection(selection.sourceId, selection.day)}>放弃并切换</VibeButton>
  </>} />;
  return <ActionDialog checkBookId="a-shares" checkHref={`/performance?book=a-shares&view=records&recordFilter=valuations&recordDay=${encodeURIComponent(day)}&recordSource=${encodeURIComponent(sourceId)}`} title="更新A股资产" description="每周日填写当天的资产总额，包含持仓和账户现金。同日保存会更新已有金额。" dirty={dirty} onClose={onClose} disabled={!sourceId} submit={() => bookRequest({ action: "asset", bookId: "a-shares", sourceId, day, amount, currency: "CNY" })}>
    <VibeSelectField fieldId="book-asset-source" label="资产来源" value={sourceId} onValueChange={id => requestSelection(id, day, "book-asset-source")} options={members.map(row => { const source = sources.find(source => source.id === row.sourceId); return { value: row.sourceId, label: source ? assetSourceDisplayName(source) : row.sourceId }; })} />
    <VibeDateField fieldId="book-asset-day" label="资产日期" max={currentDay} value={day} onValueChange={date => requestSelection(sourceId, date, "book-asset-day")} />
    <VibeAmountField key={`${sourceId}/${day}`} fieldId="book-asset-amount" label="当天资产总额（CNY）" value={amount} onValueChange={setAmount} />
    {members.length === 0 ? <VibeNotice tone="info">请先在资产页接入手工证券来源，并在本页确认来源范围。</VibeNotice> : null}
    <p className="trend-note">此处只更新资产金额。新增投入或取出资金，请另记入金或出金。</p>
  </ActionDialog>;
}
function ImportDialog({ bookId, onClose }: { bookId: InvestmentBookId; onClose(): void }) {
  const { showSensitiveInfo } = useWorkbenchDisplayPreferences();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ReturnType<typeof parseSourceInvestmentHistory> | null>(null);
  const [error, setError] = useState("");
  function inspect() {
    try { const history = parseSourceInvestmentHistory(JSON.parse(text)); if (history.currency !== investmentBook(bookId).currency) throw new Error("币种与本账不一致"); setPreview(history); setError(""); }
    catch (e) { setPreview(null); setError(e instanceof Error ? e.message : "导入格式无效"); }
  }
  return <ActionDialog checkBookId={bookId} title={`导入历史，${investmentBook(bookId).name}`} description="导入已有的投资账本 JSON。先核对截止日、本金和资产；重复导入同一原件不会重复计账。" dirty={text !== ""} onClose={onClose} disabled={!preview} button="确认导入" submit={() => bookRequest({ action: "import", bookId, history: preview })}>
    <VibeTextAreaField fieldId="book-import-json" label="历史数据 JSON" value={text} onChange={e => { setText(e.target.value); setPreview(null); }} rows={6} />
    <VibeButton type="button" variant="outline" onClick={inspect}>核对导入数据</VibeButton>
    {error ? <VibeNotice tone="error" role="alert">{error}</VibeNotice> : null}
    {preview ? <VibeNotice tone="info">{preview.accountName}，{preview.records.length} 条，截至 {preview.reconciliation.asOf}<br />净投入 <AssetFinancialValue unit={preview.currency}>{showSensitiveInfo ? bookMoney(preview.reconciliation.netInvestment) : "••••••"}</AssetFinancialValue> / 资产 <AssetFinancialValue unit={preview.currency}>{showSensitiveInfo ? bookMoney(preview.reconciliation.total) : "••••••"}</AssetFinancialValue> / 收益 <AssetFinancialValue unit={preview.currency}>{showSensitiveInfo ? bookMoney(preview.reconciliation.profit) : "••••••"}</AssetFinancialValue></VibeNotice> : null}
    <p className="trend-note">{bookId === "crypto" ? "有导入资产记录的日期优先采用历史总额，其余日期采用当天完整自动同步，不跨日补值或叠加。" : "历史总额与后续同步按截止日衔接，不叠加。"}发现原件被改写、缺失或账本冲突时会拒绝导入。</p>
  </ActionDialog>;
}
function MemberDialog({ member, currentDay, onClose }: { member: BookMember; currentDay: string; onClose(): void }) {
  const [fromDay, setFromDay] = useState(member.fromDay ?? "");
  const [toDay, setToDay] = useState(member.toDay ?? "");
  const [initial] = useState(() => ({ fromDay, toDay }));
  const validRange = fromDay !== "" && (toDay === "" || toDay >= fromDay);
  return <ActionDialog checkBookId={member.bookId} title="确认来源范围" description="接入接口不会被算成新增投资。请确认该账户从哪天起包含在整本账的资产总额里。" dirty={fromDay !== initial.fromDay || toDay !== initial.toDay} onClose={onClose} disabled={!validRange} submit={() => bookRequest({ action: "member", bookId: member.bookId, sourceId: member.sourceId, fromDay, toDay: toDay || null })}>
    <VibeDateField fieldId="book-member-from" label="计入资产的起始日" max={currentDay} value={fromDay} onValueChange={setFromDay} />
    <VibeDateField clearable fieldId="book-member-to" label="退出日（可空，当天起不再计入）" max={currentDay} value={toDay} onValueChange={setToDay} />
    {toDay !== "" && toDay < fromDay ? <VibeNotice tone="error" role="alert">退出日不能早于起始日。</VibeNotice> : null}
    <p className="trend-note">{member.fromDay === null ? "现有来源此前默认全程计入；保存后将按指定起始日重新核算自动汇总。" : "确认前暂停汇总，避免接入账户导致资产跳变被误认为收益。"} 导入历史的整本账总额保持原口径。</p>
  </ActionDialog>;
}
function ResolveDialog({ flow, bookId, state, onClose }: { flow: InvestmentCashflow; bookId: InvestmentBookId; state: InvestmentBookState; onClose(): void }) {
  const { showSensitiveInfo } = useWorkbenchDisplayPreferences();
  const [target, setTarget] = useState(bookId);
  const [recordId, setRecordId] = useState("");
  const matching = activeBookRecords(state, target).filter(row => row.day === shanghaiDay(flow.occurredAt) && row.currency === flow.currency && decimalCompare(row.amount, flow.amount) === 0 && (flow.kind === "initial-investment" ? row.kind === "opening" || row.kind === "deposit" : row.kind === (flow.kind === "external-withdrawal" ? "withdrawal" : "deposit")));
  return <ActionDialog checkBookId={target} title="确认旧资金记录归属" description={<>{shanghaiDay(flow.occurredAt)}，<AssetFinancialValue unit={flow.currency}>{showSensitiveInfo ? flow.amount : "••••••"}</AssetFinancialValue>，{flow.note ?? "无备注"}</>} dirty={target !== bookId || recordId !== ""} onClose={onClose} submit={() => bookRequest({ action: "resolve", bookId: target, cashflowId: flow.id, recordId: recordId || null })}>
    <VibeSelectField fieldId="book-resolve-target" label="归属账本" value={target} onValueChange={value => { setTarget(value as InvestmentBookId); setRecordId(""); }} options={INVESTMENT_BOOKS.map(book => ({ value: book.id, label: book.name }))} />
    <VibeSelectField fieldId="book-resolve-record" label="计账方式" value={recordId} onValueChange={setRecordId} options={[{ value: "", label: "作为一笔独立资金计入" }, ...matching.map(row => ({ value: row.id, label: `关联已有 ${row.day} ${labels[row.kind]} ${showSensitiveInfo ? row.amount : "••••••"} ${row.currency}，只计一次` }))]} />
    <p className="trend-note">确认这笔资金是否已包含在导入历史内。原始记录始终保留。</p>
  </ActionDialog>;
}

export function InvestmentBooksWorkspace({ state, initialBookId = "us-stocks", initialRecordFilter = "funds", initialRecordDay, checkSourceId, view = "performance", sources, observations, manualRecords, cashflows, currentDay }: {
  state: InvestmentBookState; initialBookId?: InvestmentBookId; initialRecordFilter?: "all" | "funds" | "valuations"; initialRecordDay?: string; checkSourceId?: string; view?: "performance" | "records"; sources: InvestmentBookSource[]; observations: DailyAssetTrendObservation[]; manualRecords: ManualAssetRecord[]; cashflows: InvestmentCashflow[]; currentDay: string;
}) {
  const bookId = initialBookId;
  const [recordFilter, setRecordFilter] = useState(initialRecordFilter);
  const [curve, setCurve] = useState<"return" | "total">("return");
  const [enabledSymbols, setEnabledSymbols] = useState<MarketBenchmarkSymbol[]>([...DEFAULT_MARKET_BENCHMARK_SYMBOLS]);
  const trendRange = useAssetTrendRange(initialRecordDay ? { preset: "custom", customRange: { startDay: initialRecordDay, endDay: initialRecordDay } } : undefined);
  const checkSource = checkSourceId ? sources.find(source => source.id === checkSourceId && source.kind === "manual") : undefined;
  const [dialog, setDialog] = useState<"fund" | "asset" | "import" | null>(null);
  const [assetDay, setAssetDay] = useState<string | undefined>();
  const [editing, setEditing] = useState<BookRecord | null>(null);
  const [voiding, setVoiding] = useState<BookRecord | null>(null);
  const [member, setMember] = useState<BookMember | null>(null);
  const [resolving, setResolving] = useState<InvestmentCashflow | null>(null);
  const { showSensitiveInfo } = useWorkbenchDisplayPreferences();
  const { liveSources, state: realtimeState, retry } = useLongbridgeRealtime(sources);
  const analysis = useMemo(() => analyzeInvestmentBook({ state, bookId, sources: liveSources, observations, manualRecords, currentDay }), [state, bookId, liveSources, observations, manualRecords, currentDay]);
  const current = analysis.summary;
  const firstValuationDay = analysis.points.find(point => point.total !== null)?.day;
  const pointMap = new Map(analysis.points.map(row => [row.day, row]));
  const days = rangeDays(trendRange.preset, currentDay, analysis.firstTrendDay ?? undefined, trendRange.customRange);
  const selectedDays = new Set(days);
  const isInterval = trendRange.preset !== "all";
  const startDay = days[0] ?? currentDay;
  const endDay = days.at(-1) ?? currentDay;
  const interval = analyzeInvestmentBookInterval({
    points: analysis.points, state, bookId, startDay, endDay,
  });
  const fundingEvents = new Map<string, AssetTrendEvent[]>();
  for (const record of analysis.records) {
    if (record.kind === "valuation") continue;
    const events = fundingEvents.get(record.day) ?? [];
    const originalAmount = longbridgeOriginalFundingAmount(record);
    events.push({ amount: record.amount, currency: record.currency, kind: record.kind, ...(originalAmount ? { originalAmount } : {}) });
    fundingEvents.set(record.day, events);
  }
  const benchmarkVisible = view === "performance" && curve === "return" && showSensitiveInfo;
  const benchmarkDataState = useInvestmentBookBenchmarkComparison({
    enabledSymbols,
    points: analysis.points.filter(point => selectedDays.has(point.day)),
    records: analysis.records,
    sources: liveSources,
    visible: benchmarkVisible,
  });
  const points = days.map(day => {
    const row = pointMap.get(day);
    const periodReturn = isInterval ? day === startDay && row?.total != null && row.netInvestment != null && decimalCompare(row.total, "0") > 0
      ? "0" : analyzeInvestmentBookInterval({ points: analysis.points, state, bookId, startDay, endDay: day }).returnRatio
      : row?.returnRatio ?? null;
    const amount = curve === "total" ? row?.total ?? null : periodReturn === null ? null : decimalMultiply(periodReturn, "100");
    return { day, amount, events: fundingEvents.get(day), observed: !!row, status: amount == null ? "incomplete" as const : "complete" as const };
  });
  const depositTotals = useMemo(() => {
    const totals = new Map<string, string | null>();
    let total = state.unassignedLegacyIds.length > 0 ? null : analysis.opening?.amount ?? null;
    const funds = analysis.records.filter(row => row.kind === "deposit" || row.kind === "withdrawal")
      .toSorted((a, b) => a.day.localeCompare(b.day) || a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id));
    for (const row of funds) {
      if (row.currency !== analysis.book.currency) total = null;
      else if (total !== null) total = decimalAdd(total, row.kind === "withdrawal" ? `-${row.amount}` : row.amount);
      if (row.kind === "deposit") totals.set(row.id, analysis.opening && row.day >= analysis.opening.day ? total : null);
    }
    return totals;
  }, [analysis, state.unassignedLegacyIds.length]);
  const timeline = [
    ...analysis.points.map(point => ({ key: `asset:${point.day}`, day: point.day, label: "资产金额", kind: "valuation" as const, amount: point.total, basis: point.basis, record: analysis.records.find(row => row.kind === "valuation" && row.day === point.day) })),
    ...analysis.records.filter(row => row.kind !== "valuation").map(row => ({ key: row.id, day: row.day, label: labels[row.kind], kind: row.kind, amount: row.amount, basis: row.origin === "statement" ? (row.currency === analysis.book.currency ? "长桥结单" : "长桥结单，待补当日汇率") : row.origin === "import" ? "导入历史" : row.origin === "legacy" ? "旧资金原件" : "手动记录", record: row })),
  ].toSorted((a, b) => b.day.localeCompare(a.day) || a.key.localeCompare(b.key));
  const filteredTimeline = timeline.filter(row => selectedDays.has(row.day) && (recordFilter === "all" || (recordFilter === "valuations" ? row.kind === "valuation" : row.kind !== "valuation")));
  const recordPagination = useTablePagination(filteredTimeline, JSON.stringify([bookId, recordFilter, days[0], days.at(-1)]));
  const pendingMembers = analysis.members.filter(row => !row.confirmed);
  const unassignedCashflows = cashflows.filter(flow => state.unassignedLegacyIds.includes(flow.id));
  const bookHref = (id: InvestmentBookId, section = view) => `/performance?book=${id}&view=${section}`;
  const metrics = [
    { label: isInterval ? "期末资产" : "资产总额", value: isInterval ? interval.total : current?.total ?? null, unit: analysis.book.currency },
    { label: isInterval ? "区间净流入" : "累计净投入", value: isInterval ? interval.netCashflow : current?.netInvestment ?? null, unit: analysis.book.currency },
    { label: isInterval ? "区间收益" : "累计收益", value: isInterval ? interval.profit : current?.profit ?? null, unit: analysis.book.currency },
    { label: isInterval ? "区间收益率" : "累计收益率", value: (isInterval ? interval.returnRatio : current?.returnRatio) == null ? null : decimalMultiply((isInterval ? interval.returnRatio : current?.returnRatio)!, "100"), unit: "%" },
  ];
  const comparisonReady = benchmarkVisible && enabledSymbols.length > 0 &&
    benchmarkDataState.kind === "ready" && benchmarkDataState.comparison.reason === null;
  return <div className="investment-books">
    <WorkbenchPageHeader title="投资账本" actions={<><AssetGlobalRefreshControl /><VibeButton type="button" variant="primary" onClick={() => setDialog("fund")}>记录出入金</VibeButton>{bookId === "a-shares" ? <VibeButton type="button" variant="outline" onClick={() => setDialog("asset")}>更新A股资产</VibeButton> : null}</>} />
    <div className="investment-books__navigation">
      <WorkspaceViewNavigation label="选择投资账本" current={bookHref(bookId)} items={INVESTMENT_BOOKS.map(book => ({ href: bookHref(book.id), label: book.name }))} />
      <WorkspaceViewNavigation label="账本视角" current={bookHref(bookId)} items={[
        { href: bookHref(bookId, "performance"), label: "收益表现" },
        { href: bookHref(bookId, "records"), label: "记账记录" },
      ]} />
    </div>
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
        <span>{shanghaiDay(flow.occurredAt)}</span><strong>{showSensitiveInfo ? <AssetFinancialValue unit={flow.currency}>{bookMoney(flow.amount)}</AssetFinancialValue> : "••••••"}</strong>
        <VibeButton type="button" size="compact" variant="outline" onClick={() => setResolving(flow)}>核对归属</VibeButton>
      </li>)}</ul>
    </section> : null}
    </div> : null}
    <LongbridgeRealtimeNotice state={realtimeState} retry={retry} sourceId={sources.find(source => source.kind === "longbridge" && source.lifecycle !== "disconnected")?.id} />
    {view === "performance" ? <section className="source-performance" aria-label={`${analysis.book.name}投资表现`}>
      <div className="investment-books__summary-toolbar">
        <header className="source-performance__heading"><h2>{isInterval ? "区间表现" : "累计表现"}</h2><p>{isInterval ? `${startDay} 至 ${endDay}` : current?.total != null ? `截至 ${current.day}` : "暂无完整资产记录"}</p></header>
      </div>
      <div className="source-performance__metrics investment-books__metrics">{metrics.map(metric => <article key={metric.label}><p className="card-label">{metric.label}</p>{showSensitiveInfo && metric.value == null ? <p className="investment-books__metric-unavailable">数据不足</p> : <VibeMetric animate={false} value={!showSensitiveInfo ? "••••••" : bookMoney(metric.value!)} unit={metric.unit} />}</article>)}</div>
      {showSensitiveInfo && (isInterval ? analysis.fundingMissingReason : analysis.summaryMissingReason) ? <VibeNotice tone="info" role="status">{isInterval ? analysis.fundingMissingReason : analysis.summaryMissingReason}</VibeNotice> : null}
      {showSensitiveInfo && isInterval && (pointMap.get(startDay)?.total == null || pointMap.get(endDay)?.total == null) ? <VibeNotice tone="info" role="status">所选起止日期缺少完整资产估值，区间收益暂不可算。可调整日期，或在记账记录中补齐估值。</VibeNotice> : showSensitiveInfo && isInterval && startDay === endDay ? <VibeNotice tone="info" role="status">计算区间收益需选择至少两个日期。</VibeNotice> : null}
      {showSensitiveInfo && analysis.historyComparison ? <details className="daily-trend-details investment-books__reconciliation">
          <summary><span className="investment-books__reconciliation-label"><time dateTime={analysis.historyComparison.day}>{analysis.historyComparison.day}</time><span>历史与同步差额</span></span><span className="investment-books__reconciliation-amount"><AssetFinancialValue unit={analysis.book.currency}>{bookMoney(analysis.historyComparison.difference)}</AssetFinancialValue></span></summary>
          <div className="daily-trend-details-content">
            <dl>
              <div><dt>历史总额</dt><dd><AssetFinancialValue unit={analysis.book.currency}>{bookMoney(analysis.historyComparison.historicalTotal)}</AssetFinancialValue></dd></div>
              <div><dt>自动汇总</dt><dd><AssetFinancialValue unit={analysis.book.currency}>{bookMoney(analysis.historyComparison.automaticTotal)}</AssetFinancialValue></dd></div>
            </dl>
            <p>请核对采集时间和来源范围。{bookId === "crypto" ? "有导入资产记录的日期优先采用历史总额，其余日期采用当天完整自动汇总；" : "历史截止日及以前采用历史总额，之后接自动汇总；"}差额不会补成入金，两份金额不会相加。</p>
          </div>
        </details> : null}
      <AssetTrendPanel
        benchmark={benchmarkVisible ? {
          assetScopeLabel: analysis.book.name,
          comparison: benchmarkDataState.kind === "ready" ? benchmarkDataState.comparison : null,
          enabledSymbols,
          returnComparison: true,
        } : null}
        range={{ ...trendRange, currentDay, firstDay: analysis.firstTrendDay ?? undefined }}
        metricControls={<header className="source-performance__chart-toolbar investment-books__chart-heading">
          <h2>{curve === "return" ? comparisonReady ? "区间收益率对比" : isInterval ? "区间收益率走势" : "累计收益率走势" : "总资产趋势"}</h2>
          <div className="source-performance__curve-options" role="group" aria-label="趋势指标">
            {(["total", "return"] as const).map(value => <VibeButton key={value} type="button" variant={curve === value ? "primary" : "outline"} size="compact" aria-pressed={curve === value} onClick={() => setCurve(value)}>{value === "return" ? "收益率" : "总资产"}</VibeButton>)}
          </div>
        </header>}
        ariaLabel={`${analysis.book.name}${curve === "return" ? "收益率走势" : "总资产趋势"}`}
        currency={curve === "return" ? "%" : analysis.book.currency}
        formatAmount={bookMoney}
        formatDay={formatShanghaiDayLabel}
        dateAxisPresentation="compact"
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
          returnLabel={isInterval ? "区间收益率" : "累计收益率"}
        /> : null}
        {showSensitiveInfo && firstValuationDay && analysis.firstRecordDay && analysis.firstRecordDay < firstValuationDay && days[0] < firstValuationDay
          ? <p className="trend-note">{formatShanghaiFullDayLabel(firstValuationDay)} 前缺少完整资产估值。</p>
          : null}
      </AssetTrendPanel>
      <details className="daily-trend-details"><summary>计算口径</summary><div className="daily-trend-details-content"><p>全部日期的累计指标统一截至最近完整估值日，不混入之后的资金，趋势缺口保持为空。选择其他区间后，指标严格按所选起止日计算；缺少端点估值时留空。</p><p>区间收益 = 期末资产 − 起点资产 − 区间净流入。估值按日末计，净流入包含起点之后、终点当日及之前的入金减出金；起点当日资金已包含在起点资产中。记录列表包含所选起止日的全部生效记录。</p><p>累计收益 = 资产总额 − 期初本金 − 累计入金 + 累计出金。收益率采用 Modified Dietz 扣除入出金影响，不年化；指数对比从共同可用起点重新计算，起点见图上标记。</p><p>指数不含分红，按各自本币计算，不折算汇率。使用上海当日零点前已收盘日 K，休市沿用前收盘。</p><p>{bookId === "crypto" ? "有导入资产记录（含更正）的日期优先采用历史整本账总额，其余日期采用当天最新完整自动同步，不跨日补值；" : "导入历史截止日及以前采用历史整本账总额，之后采用同步或手动资产记录；"}同一天只计一个总额。缺少资产或汇率时留空。</p><p>虚拟货币合并交易所、钱包和手动补充来源。账内互转不增加本金；三本账之间转账需分别记录一笔出金、一笔入金。</p></div></details>
    </section> : null}
    {view === "records" ? <section className="source-performance" aria-label="统一记账记录">
      <header className="investment-books__section-heading">
        <h2>记账记录</h2>
        <VibeButton type="button" variant="outline" onClick={() => setDialog("import")}>导入历史记账</VibeButton>
      </header>
      {checkSourceId && initialRecordDay ? checkSource
        ? <ManualAssetRecordCheck sourceId={checkSource.id} sourceName={assetSourceDisplayName(checkSource)} day={initialRecordDay} records={manualRecords} />
        : <VibeNotice tone="warning">来源不可用，暂时无法核对资产记录。请先核对来源状态。</VibeNotice>
        : null}
      <div className="investment-books__record-toolbar">
        <div className="investment-books__record-filters" role="group" aria-label="记账记录类型">
          {([ ["funds", "出入金"], ["valuations", "资产估值"], ["all", "全部记录"] ] as const).map(([value, label]) => <VibeButton key={value} type="button" aria-pressed={recordFilter === value} variant={recordFilter === value ? "primary" : "outline"} onClick={() => setRecordFilter(value)}>{label}</VibeButton>)}
        </div>
        <div className="investment-books__record-range">
          <AssetTrendRangeControls range={{ ...trendRange, currentDay, firstDay: analysis.firstTrendDay ?? undefined }} />
        </div>
      </div>
      {showSensitiveInfo && filteredTimeline.length === 0 ? <div className="investment-books__empty"><p className="trend-note">所选区间暂无{recordFilter === "funds" ? "出入金" : recordFilter === "valuations" ? "资产估值" : "记账"}记录。</p>{trendRange.preset !== "all" ? <VibeButton type="button" variant="text" onClick={() => trendRange.onChange("all", null)}>查看全部日期</VibeButton> : null}</div> : null}
      {showSensitiveInfo ? <ol className="manual-asset-history-list investment-books__record-list">
        {recordPagination.visibleItems.map(row => <li key={row.key} title={row.record?.note}>
          <div className="investment-books__record-identity">
            <time dateTime={row.day}>{row.day}</time>
            <span>{row.label}<small className="investment-books__basis">{row.basis}</small></span>
          </div>
          <strong className="investment-books__record-amount">
            <InvestmentBookRecordAmount amount={row.amount} currency={row.record?.currency ?? analysis.book.currency} record={row.record} />
            {row.kind === "deposit" ? <small className="investment-books__basis investment-books__record-total">
              <span>累计净投入</span>
              <span>{depositTotals.get(row.key) == null ? "数据不足" : <AssetFinancialValue unit={analysis.book.currency}>{bookMoney(depositTotals.get(row.key)!)}</AssetFinancialValue>}</span>
            </small> : null}
          </strong>
          <div className="source-performance__record-actions">
            {row.record ? <>
              {row.record.currency === analysis.book.currency ? <VibeButton type="button" variant="text" onClick={() => setEditing(row.record!)} aria-label={`更正 ${row.day} ${row.label}`}>更正</VibeButton> : null}
              <VibeButton type="button" variant="text" tone="danger" onClick={() => setVoiding(row.record!)} aria-label={`作废 ${row.day} ${row.label}`}>作废</VibeButton>
            </> : row.basis === "手动资产金额" ? <VibeButton type="button" variant="text" onClick={() => { setAssetDay(row.day); setDialog("asset"); }}>更新资产</VibeButton> : null}
          </div>
        </li>)}
      </ol> : <p className="trend-note">金额及记录已隐藏。</p>}
      {showSensitiveInfo ? <VibeTablePagination label="记账记录分页" pagination={recordPagination.controls} /> : null}
    </section> : null}
    {dialog === "fund" || editing ? <FundDialog initialBookId={bookId} state={state} currentDay={currentDay} record={editing ?? undefined} onClose={() => { setDialog(null); setEditing(null); }} /> : null}
    {dialog === "asset" ? <AssetDialog state={state} sources={sources} manualRecords={manualRecords} currentDay={currentDay} initialDay={assetDay} onClose={() => { setDialog(null); setAssetDay(undefined); }} /> : null}
    {dialog === "import" ? <ImportDialog bookId={bookId} onClose={() => setDialog(null)} /> : null}
    {member ? <MemberDialog member={member} currentDay={currentDay} onClose={() => setMember(null)} /> : null}
    {resolving ? <ResolveDialog flow={resolving} bookId={bookId} state={state} onClose={() => setResolving(null)} /> : null}
    {voiding ? <ActionDialog checkBookId={bookId} title="作废这条记录？" description={<>{voiding.day}，{labels[voiding.kind]}，<AssetFinancialValue unit={voiding.currency}>{showSensitiveInfo ? voiding.amount : "••••••"}</AssetFinancialValue>。作废后重算收益，原件保留。</>} button="确认作废" onClose={() => setVoiding(null)} submit={() => bookRequest({ action: "void", bookId, id: voiding.id, confirmation: "VOID_RECORD" })} >{voiding.kind === "opening" ? <p>作废期初本金后，需补齐起点才能重新计算收益。</p> : null}</ActionDialog> : null}
  </div>;
}
