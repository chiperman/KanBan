import { decimalAdd, decimalCompare, decimalDivide, decimalMultiply, decimalSubtract, decimalToFixed } from "@/domain/decimal";
import { shanghaiDay } from "@/domain/daily-asset-snapshots";
import { sourceInvestmentBookId, type InvestmentBookId } from "@/domain/source-investment-book";
import { parseSourceInvestmentRecordInput, type SourceInvestmentRecord, type SourceInvestmentRecordKind } from "@/domain/source-investment-records";
import { buildTotalValuation, type ValuationSource } from "@/domain/valuation";
import type { DailyAssetTrendObservation } from "@/domain/asset-history";
import type { InvestmentCashflow } from "@/domain/investment-cashflows";
import type { ManualAssetRecord } from "@/domain/manual-asset-records";
import { parseSourceInvestmentHistory, type SourceInvestmentHistory } from "@/domain/source-investment-history";

export const INVESTMENT_BOOKS = [
  { id: "us-stocks", name: "美股", currency: "USD", automatic: true },
  { id: "a-shares", name: "A股", currency: "CNY", automatic: false },
  { id: "crypto", name: "虚拟货币", currency: "USD", automatic: true },
] as const;
export type { InvestmentBookId } from "@/domain/source-investment-book";
export type BookSource = ValuationSource & { lifecycle?: string };
export type BookRecord = {
  id: string;
  bookId: InvestmentBookId;
  day: string;
  kind: SourceInvestmentRecordKind;
  amount: string;
  currency: "USD" | "CNY" | "HKD";
  note: string;
  recordedAt: string;
  origin: "import" | "manual" | "legacy" | "statement" | "provider";
  originKey: string;
  voidedAt?: string;
  replacesId?: string;
};
export type BookMember = {
  sourceId: string;
  bookId: InvestmentBookId;
  fromDay: string | null;
  toDay: string | null;
  confirmed: boolean;
};
export interface InvestmentBookState {
  version: 1;
  records: BookRecord[];
  members: BookMember[];
  legacyLinks: Array<{ cashflowId: string; recordId: string }>;
  unassignedLegacyIds: string[];
  historyThroughDay: Partial<Record<InvestmentBookId, string>>;
  imports: SourceInvestmentHistory[];
}
export interface InvestmentBookStore {
  readInvestmentBooks(): Promise<InvestmentBookState>;
  saveBookRecord(bookId: InvestmentBookId, value: unknown, capturedAt: string): Promise<void>;
  voidBookRecord(bookId: InvestmentBookId, id: string, capturedAt: string): Promise<void>;
  importBookHistory(bookId: InvestmentBookId, value: unknown): Promise<void>;
  confirmBookMember(sourceId: string, fromDay: string, toDay: string | null): Promise<void>;
  resolveLegacyCashflow(bookId: InvestmentBookId, cashflowId: string, recordId: string | null): Promise<void>;
}
export function investmentBook(id: unknown) {
  const book = INVESTMENT_BOOKS.find(book => book.id === id);
  if (!book) throw new Error("投资账本无效");
  return book;
}
export const sourceBookId = sourceInvestmentBookId;
export function activeBookRecords(state: InvestmentBookState, bookId: InvestmentBookId) {
  return state.records.filter(row => row.bookId === bookId && !row.voidedAt);
}
export function bookHistoryPrefix(history: Pick<SourceInvestmentHistory, "provider" | "accountId">): string {
  return `history:${encodeURIComponent(history.provider)}:${encodeURIComponent(history.accountId)}`;
}
export function bookHistoryRecords(history: SourceInvestmentHistory, bookId: InvestmentBookId): BookRecord[] {
  const prefix = bookHistoryPrefix(history);
  return [{ id: "opening", kind: "opening" as const, ...history.openingInvestment }, ...history.records].map(row => ({
    ...row, amount: decimalAdd("0", row.amount), id: `${prefix}:${encodeURIComponent(row.id)}`, bookId,
    currency: investmentBook(bookId).currency, origin: "import", originKey: `${prefix}:${encodeURIComponent(row.id)}`,
    recordedAt: history.importedAt, note: (row.kind === "opening" ? history.openingBasis : `${history.provider} · ${history.accountName} · 原始记录 ${row.id}`).slice(0, 1000),
  }));
}
function assertDay(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value + "T00:00:00Z")) ||
      new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value) throw new Error("账本日期无效");
}
function text(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 10000) throw new Error("账本标识无效");
}
export function validateInvestmentBookState(value: unknown): InvestmentBookState {
  if (!value || typeof value !== "object") throw new Error("账本数据无效");
  const state = value as InvestmentBookState;
  if (state.version !== 1 || !Array.isArray(state.records) || !Array.isArray(state.members) ||
      !Array.isArray(state.legacyLinks) || !Array.isArray(state.unassignedLegacyIds) ||
      !Array.isArray(state.imports) || !state.historyThroughDay || typeof state.historyThroughDay !== "object" || Array.isArray(state.historyThroughDay)) throw new Error("账本版本或记录无效");
  for (const history of state.imports) parseSourceInvestmentHistory(history);
  for (const [id, day] of Object.entries(state.historyThroughDay)) { investmentBook(id); assertDay(day); }
  const ids = new Set<string>(), origins = new Set<string>(), members = new Set<string>(), links = new Set<string>();
  for (const row of state.records) {
    if (!row || typeof row !== "object" || !Number.isFinite(Date.parse(row.recordedAt))) throw new Error("账本记录无效");
    const book = investmentBook(row.bookId);
    text(row.id);
    if (!["opening", "deposit", "withdrawal", "valuation"].includes(row.kind)) throw new Error("账本记录类型无效");
    // Imported identities include the external account and may exceed the manual form's ID limit.
    const parsed = parseSourceInvestmentRecordInput({ ...row, id: "validated-book-record", ...(row.origin === "import" ? { kind: "valuation" } : {}) }, row.recordedAt);
    const pendingStatementFX = row.origin === "statement" && book.id === "us-stocks" &&
      parsed.currency === "HKD" && (row.kind === "deposit" || row.kind === "withdrawal");
    if ((book.currency !== parsed.currency && !pendingStatementFX) || !["import", "manual", "legacy", "statement", "provider"].includes(row.origin) ||
        (row.origin === "provider" && (row.kind !== "valuation" || row.bookId !== "us-stocks")) ||
        typeof row.note !== "string" || row.note.length > 1000) throw new Error("账本币种或记录来源无效");
    text(row.originKey);
    if (ids.has(row.id) || origins.has(row.originKey)) throw new Error("账本记录重复");
    if (row.voidedAt && !Number.isFinite(Date.parse(row.voidedAt))) throw new Error("账本更正时间无效");
    ids.add(row.id); origins.add(row.originKey);
  }
  for (const book of INVESTMENT_BOOKS) {
    const rows = activeBookRecords(state, book.id);
    const openings = rows.filter(row => row.kind === "opening");
    if (openings.length > 1 || (openings[0] && rows.some(row => row.kind !== "valuation" && row.day < openings[0].day))) throw new Error("每本账期初本金必须唯一且不晚于其他资金记录");
    const days = rows.filter(row => row.kind === "valuation").map(row => row.day);
    if (new Set(days).size !== days.length) throw new Error("同本账同日只能有一条有效资产金额");
  }
  for (const row of state.records) if (row.replacesId) {
    const old = state.records.find(old => old.id === row.replacesId);
    if (!old?.voidedAt || old.id === row.id || old.bookId !== row.bookId || old.kind !== row.kind) throw new Error("账本更正关联无效");
    if (state.records.filter(next => next.replacesId === old.id).length !== 1 || Date.parse(old.recordedAt) > Date.parse(row.recordedAt)) throw new Error("账本更正顺序无效");
    const visited = new Set([row.id]);
    let previous: BookRecord | undefined = old;
    while (previous) {
      if (visited.has(previous.id)) throw new Error("账本更正存在循环");
      visited.add(previous.id);
      previous = state.records.find(candidate => candidate.id === previous!.replacesId);
    }
  }
  const importedIds = new Set<string>();
  const cutoffs: InvestmentBookState["historyThroughDay"] = {};
  for (const history of state.imports) {
    const prefix = bookHistoryPrefix(history);
    const originals = state.records.filter(row => row.origin === "import" && row.originKey.startsWith(`${prefix}:`));
    const bookId = originals[0]?.bookId;
    if (!bookId || history.currency !== investmentBook(bookId).currency) throw new Error("导入原件缺少账本记录或币种不一致");
    for (const expected of bookHistoryRecords(history, bookId)) {
      const original = originals.find(row => row.id === expected.id);
      if (!original || original.bookId !== bookId || original.originKey !== expected.originKey ||
          original.day !== expected.day || original.kind !== expected.kind || original.currency !== expected.currency ||
          decimalCompare(original.amount, expected.amount) !== 0) throw new Error("导入原件与账本记录不一致");
      importedIds.add(original.id);
    }
    cutoffs[bookId] = [cutoffs[bookId] ?? "", history.reconciliation.asOf].sort().at(-1)!;
  }
  if (state.records.some(row => row.origin === "import" && !importedIds.has(row.id)) ||
      INVESTMENT_BOOKS.some(book => state.historyThroughDay[book.id] !== cutoffs[book.id])) throw new Error("历史衔接日期或导入记录与原件不一致");
  for (const member of state.members) {
    text(member.sourceId); investmentBook(member.bookId);
    if (members.has(member.sourceId) || typeof member.confirmed !== "boolean") throw new Error("账本来源重复或状态无效");
    if (member.fromDay !== null) assertDay(member.fromDay);
    if (member.toDay !== null) {
      assertDay(member.toDay);
      if (member.fromDay !== null && member.toDay < member.fromDay) throw new Error("来源退出日期早于加入日期");
    }
    members.add(member.sourceId);
  }
  const linkedRecords = new Set<string>();
  for (const link of state.legacyLinks) {
    text(link.cashflowId);
    const record = state.records.find(row => row.id === link.recordId);
    if (!record || record.kind === "valuation" || links.has(link.cashflowId) || linkedRecords.has(link.recordId)) throw new Error("历史资金关联无效");
    links.add(link.cashflowId);
    linkedRecords.add(link.recordId);
  }
  for (const id of state.unassignedLegacyIds) {
    text(id);
    if (links.has(id)) throw new Error("历史资金归属重复");
    links.add(id);
  }
  return state;
}

/** Every legacy fact is either explicitly linked or awaiting review, never silently dropped. */
export function validateBookLegacyCoverage(state: InvestmentBookState, cashflows: InvestmentCashflow[]): void {
  const assigned = [...state.legacyLinks.map(row => row.cashflowId), ...state.unassignedLegacyIds];
  if (assigned.length !== cashflows.length || cashflows.some(flow => !assigned.includes(flow.id))) {
    throw new Error("三本账与旧资金原件不一致");
  }
  for (const link of state.legacyLinks) {
    const flow = cashflows.find(flow => flow.id === link.cashflowId)!;
    const record = state.records.find(row => row.id === link.recordId)!;
    const kind = flow.kind === "initial-investment" && record.kind === "opening" ? "opening" : flow.kind === "external-withdrawal" ? "withdrawal" : "deposit";
    if (record.day !== shanghaiDay(flow.occurredAt) || record.currency !== flow.currency ||
        record.kind !== kind || decimalCompare(record.amount, flow.amount) !== 0) {
      throw new Error("旧资金关联与原件不一致");
    }
  }
}

export function migrateInvestmentBooks(input: {
  sources: BookSource[];
  histories: SourceInvestmentHistory[];
  sourceRecords: SourceInvestmentRecord[];
  cashflows: InvestmentCashflow[];
}): InvestmentBookState {
  const state: InvestmentBookState = { version: 1, records: [], members: [], legacyLinks: [], unassignedLegacyIds: [], historyThroughDay: {}, imports: structuredClone(input.histories) };
  for (const source of input.sources) {
    const bookId = sourceBookId(source);
    if (bookId) state.members.push({ sourceId: source.id, bookId, fromDay: null, toDay: null, confirmed: true });
  }
  for (const history of input.histories) {
    const member = state.members.find(member => member.sourceId === history.sourceId);
    if (!member) throw new Error("导入历史无法确定所属账本，请先核对来源类别");
    if (investmentBook(member.bookId).currency !== history.currency) throw new Error("历史币种与账本币种不一致");
    state.historyThroughDay[member.bookId] = [state.historyThroughDay[member.bookId] ?? "", history.reconciliation.asOf].sort().at(-1)!;
    state.records.push(...bookHistoryRecords(history, member.bookId));
  }
  for (const row of input.sourceRecords) {
    const member = state.members.find(member => member.sourceId === row.sourceId);
    if (!member) throw new Error("手动投资历史无法确定所属账本");
    const superseded = row.kind === "valuation" && state.records.some(old => old.bookId === member.bookId && old.kind === "valuation" && old.day === row.day);
    state.records.push({ ...row, currency: row.currency as "USD" | "CNY", bookId: member.bookId, origin: "manual", originKey: `source-record:${row.id}`, note: "迁移自来源手动记账", ...(superseded ? { voidedAt: row.recordedAt } : {}) });
  }
  // Only link a complete, externally identified dataset. Equal date/amount alone is not identity.
  const linked = new Set<string>();
  for (const history of input.histories) {
    const candidates = input.cashflows.filter(flow => flow.note?.includes(`外部账户 ${history.accountId}`));
    const imported = state.records.filter(row => row.origin === "import" && row.originKey.startsWith(`${bookHistoryPrefix(history)}:`) && (row.kind === "deposit" || row.kind === "withdrawal"));
    if (!candidates.length || candidates.length !== imported.length) continue;
    const remaining = [...imported];
    const pairs: InvestmentBookState["legacyLinks"] = [];
    for (const flow of candidates) {
      const matches = remaining.filter(row => row.day === shanghaiDay(flow.occurredAt) &&
        row.currency === flow.currency && decimalCompare(row.amount, flow.amount) === 0 &&
        row.kind === (flow.kind === "external-withdrawal" ? "withdrawal" : "deposit"));
      if (matches.length !== 1) break;
      pairs.push({ cashflowId: flow.id, recordId: matches[0].id });
      remaining.splice(remaining.indexOf(matches[0]), 1);
    }
    if (pairs.length === candidates.length) for (const pair of pairs) { state.legacyLinks.push(pair); linked.add(pair.cashflowId); }
  }
  state.unassignedLegacyIds = input.cashflows.filter(flow => !linked.has(flow.id)).map(flow => flow.id);
  validateInvestmentBookState(state);
  validateBookLegacyCoverage(state, input.cashflows);
  return state;
}

export type BookPoint = {
  day: string;
  total: string | null;
  netInvestment: string | null;
  profit: string | null;
  returnRatio: string | null;
  basis: string;
};
export type BookValuation = { day: string; amount: string | null; basis: string };

/** 日末估值之间的区间表现；起点当日资金已包含在起点资产内，不重复扣除。 */
export function analyzeInvestmentBookInterval(input: {
  points: BookPoint[];
  state: InvestmentBookState;
  bookId: InvestmentBookId;
  startDay: string;
  endDay: string;
}) {
  const start = input.points.find(point => point.day === input.startDay);
  const end = input.points.find(point => point.day === input.endDay);
  const records = activeBookRecords(input.state, input.bookId).filter(record => record.day <= input.endDay);
  const opening = records.find(record => record.kind === "opening");
  const currency = investmentBook(input.bookId).currency;
  const flows = records.filter(record =>
    (record.kind === "deposit" || record.kind === "withdrawal") &&
    record.day > input.startDay);
  const signed = (record: BookRecord) => record.kind === "withdrawal" ? decimalSubtract("0", record.amount) : record.amount;
  const fundingComplete = opening !== undefined && opening.day <= input.startDay &&
    input.state.unassignedLegacyIds.length === 0 && records.every(record =>
      (record.kind !== "deposit" && record.kind !== "withdrawal") || record.currency === currency);
  const netCashflow = fundingComplete ? decimalAdd(...flows.map(signed)) : null;
  const span = Date.parse(input.endDay) - Date.parse(input.startDay);
  const profit = span <= 0 || start?.total == null || end?.total == null || netCashflow === null
    ? null : decimalSubtract(decimalSubtract(end.total, start.total), netCashflow);
  const denominator = profit === null || start?.total == null ? null : decimalAdd(start.total, ...flows.map(record =>
    decimalMultiply(signed(record), decimalDivide(String(Date.parse(input.endDay) - Date.parse(record.day)), String(span)))));
  const returnRatio = profit === null || denominator === null || decimalCompare(denominator, "0") <= 0
    ? null : decimalDivide(profit, denominator);
  return { total: end?.total ?? null, netCashflow, profit, returnRatio };
}

export function analyzeInvestmentBook(input: {
  state: InvestmentBookState;
  bookId: InvestmentBookId;
  sources: BookSource[];
  observations: DailyAssetTrendObservation[];
  manualRecords: ManualAssetRecord[];
  currentDay: string;
}) {
  const book = investmentBook(input.bookId);
  const records = activeBookRecords(input.state, book.id).filter(row => row.day <= input.currentDay);
  const members = input.state.members.filter(member => member.bookId === book.id);
  const historyThrough = input.state.historyThroughDay[book.id];
  const values = new Map<string, BookValuation>();
  const automaticValues = new Map<string, string | null>();
  const required = (day: string) => members.filter(member => (member.fromDay === null || member.fromDay <= day) && (member.toDay === null || day < member.toDay));
  for (const observation of input.observations) {
    if (!book.automatic) continue;
    const roster = required(observation.day);
    const rows = roster.map(member => observation.sources.find(row => row.sourceId === member.sourceId));
    const complete = roster.length > 0 && roster.every(member => member.confirmed) &&
      rows.every(row => row?.complete && (row.status ?? "complete") === "complete" && row.total[book.currency] != null);
    const amount = complete ? decimalAdd(...rows.map(row => row!.total[book.currency]!)) : null;
    automaticValues.set(observation.day, amount);
    // Crypto imports only take precedence on recorded dates; complete same-day observations fill gaps.
    if (!historyThrough || observation.day > historyThrough || (book.id === "crypto" && amount !== null)) values.set(observation.day, { day: observation.day, amount, basis: observation.day === input.currentDay ? "当日累计观测" : "自动同步汇总" });
  }
  const todayMembers = required(input.currentDay);
  if (book.automatic && !automaticValues.has(input.currentDay)) {
    const sources = todayMembers.map(member => input.sources.find(source => source.id === member.sourceId));
    const ready = todayMembers.length > 0 && todayMembers.every(member => member.confirmed) && sources.every(source => source &&
      sourceBookId(source) === book.id &&
      (source.kind !== "manual" || source.hasManualRecord !== false) &&
      source.lifecycle !== "disconnected" && source.sync.status === "current" &&
      (source.kind === "manual" || (shanghaiDay(source.snapshot.syncedAt) === input.currentDay &&
        (source.sync.recentAttempts === undefined || source.sync.recentAttempts.some(attempt =>
          attempt.mode === "all" && attempt.outcome === "success" && shanghaiDay(attempt.attemptedAt) === input.currentDay)))));
    const valuation = ready ? buildTotalValuation(sources as BookSource[], book.currency, "source", input.sources) : null;
    const amount = valuation && !valuation.incomplete && valuation.expiredCount === 0 ? valuation.amount : null;
    automaticValues.set(input.currentDay, amount);
    if (!historyThrough || input.currentDay > historyThrough || (book.id === "crypto" && amount !== null)) values.set(input.currentDay, { day: input.currentDay, amount, basis: "自动同步汇总（含手动补充来源）" });
  }
  if (!book.automatic) {
    const days = [...new Set(input.manualRecords.filter(row => members.some(member => member.sourceId === row.sourceId)).map(row => row.day))];
    for (const day of days) {
      if (historyThrough && day <= historyThrough) continue;
      const roster = required(day);
      const rows = roster.map(member => input.manualRecords.filter(row => row.sourceId === member.sourceId && row.day <= day).toSorted((a,b) => b.day.localeCompare(a.day))[0]);
      values.set(day, { day, amount: roster.length && roster.every(member => member.confirmed) && rows.every(row => row?.currency === book.currency) ? decimalAdd(...rows.map(row => row.amount)) : null, basis: "手动资产金额" });
    }
  }
  // Canonical explicit totals replace the day's automatic/manual evidence; never add them together.
  const recordsById = new Map(input.state.records.map(row => [row.id, row]));
  const importedValuationDays = new Set<string>();
  for (const row of records.filter(row => row.kind === "valuation").toSorted((a,b) => a.origin === b.origin ? 0 : a.origin === "import" ? -1 : 1)) {
    if (book.automatic && row.origin === "import" && historyThrough && row.day > historyThrough) continue;
    values.set(row.day, { day: row.day, amount: row.amount, basis: row.origin === "provider" ? "长桥每日资产" : row.origin === "import" ? "导入历史总额" : "手动账本总额" });
    let original = row;
    while (original.replacesId) original = recordsById.get(original.replacesId)!;
    if (original.origin === "import") importedValuationDays.add(row.day);
  }
  const historyComparison = [...automaticValues.entries()].filter(([day, amount]) => {
    const historical = values.get(day);
    return day <= input.currentDay && historyThrough && day <= historyThrough &&
      amount !== null && importedValuationDays.has(day) && historical?.amount != null &&
      decimalCompare(decimalToFixed(amount, 2), decimalToFixed(historical.amount, 2)) !== 0;
  }).toSorted(([a], [b]) => b.localeCompare(a)).map(([day, amount]) => ({
    day, historicalTotal: values.get(day)!.amount!, automaticTotal: amount!,
    difference: decimalSubtract(amount!, values.get(day)!.amount!),
  }))[0] ?? null;
  const opening = records.find(row => row.kind === "opening");
  const unresolved = input.state.unassignedLegacyIds.length > 0;
  const pendingFX = records.filter(row => (row.kind === "deposit" || row.kind === "withdrawal") && row.currency !== book.currency);
  const firstRecordDay = records.map(row => row.day).toSorted()[0] ?? null;
  const firstAssetPointDay = [...values.values()]
    .filter(row => row.day <= input.currentDay)
    .map(row => row.day)
    .toSorted()[0] ?? null;
  const firstTrendDay = [firstRecordDay, firstAssetPointDay]
    .filter((day): day is string => day !== null)
    .toSorted()[0] ?? null;
  const points: BookPoint[] = [...values.values()].filter(row => row.day <= input.currentDay).sort((a,b) => a.day.localeCompare(b.day)).map(value => {
    const valid = opening && value.day >= opening.day && !unresolved && !pendingFX.some(row => row.day <= value.day);
    const flows = records.filter(row => (row.kind === "deposit" || row.kind === "withdrawal") && row.day <= value.day);
    const signed = (row: BookRecord) => row.kind === "withdrawal" ? `-${row.amount}` : row.amount;
    const netInvestment = valid ? decimalAdd(opening.amount, ...flows.map(signed)) : null;
    const profit = value.amount === null || netInvestment === null ? null : decimalSubtract(value.amount, netInvestment);
    const span = opening ? Date.parse(value.day) - Date.parse(opening.day) : 0;
    const denominator = valid && span > 0 ? decimalAdd(opening.amount, ...flows.map(row => decimalMultiply(signed(row), decimalDivide(String(Date.parse(value.day) - Date.parse(row.day)), String(span))))) : null;
    const returnRatio = profit === null ? null : span === 0 && decimalCompare(profit, "0") === 0 ? "0" :
      denominator !== null && decimalCompare(denominator, "0") > 0 ? decimalDivide(profit, denominator) : null;
    return { day: value.day, total: value.amount, netInvestment, profit, returnRatio, basis: value.basis };
  });
  const current = points.at(-1) ?? null;
  // A summary keeps one actual valuation date; daily points and interval endpoints stay strict.
  const summary = points.findLast(point => point.total !== null) ?? current;
  const fundingMissingReason = unresolved ? "旧资金记录尚有未确认归属，收益暂停计算，避免漏算或重复。" :
      pendingFX.length ? "结单资金缺少当日参考汇率，已保留原币金额；本账美元本金、盈亏及收益率待补齐。" :
      !opening ? "历史本金待补齐。请导入历史，或填写起点日期、期初本金及之后的入金出金。" : null;
  const assetMissingReason = "资产数据尚未完整。请检查来源同步、计价汇率和账本来源范围。";
  return {
    book, opening, records, members, points, current, summary,
    firstRecordDay, firstAssetPointDay, firstTrendDay, historyComparison, fundingMissingReason,
    missingReason: fundingMissingReason ?? (current?.total == null ? assetMissingReason : null),
    summaryMissingReason: fundingMissingReason ?? (summary?.total == null ? assetMissingReason : null),
  };
}

/** 单一手工来源可复用本账生效资产历史；多来源整账总额不能分摊到单个账户。 */
export function manualSourceBookAssetHistory(input: Omit<Parameters<typeof analyzeInvestmentBook>[0], "bookId"> & {
  sourceId: string;
}) {
  const source = input.sources.find(source => source.id === input.sourceId);
  const members = input.state.members.filter(member => member.bookId === "a-shares");
  if (source?.kind !== "manual" || sourceBookId(source) !== "a-shares" ||
      members.length !== 1 || members[0].sourceId !== input.sourceId || !members[0].confirmed ||
      !activeBookRecords(input.state, "a-shares").some(record => record.kind === "valuation")) return null;
  const analysis = analyzeInvestmentBook({ ...input, bookId: "a-shares" });
  return {
    currency: analysis.book.currency,
    records: analysis.points.map(point => ({
      day: point.day,
      amount: point.total,
      currency: analysis.book.currency,
    })),
  };
}
