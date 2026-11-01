import {
  activeBookRecords, bookHistoryPrefix, bookHistoryRecords, investmentBook, migrateInvestmentBooks, sourceBookId,
  validateBookLegacyCoverage, validateInvestmentBookState, type BookRecord, type InvestmentBookId, type InvestmentBookState,
} from "@/domain/investment-books";
import { parseSourceInvestmentRecordInput } from "@/domain/source-investment-records";
import { parseSourceInvestmentHistory } from "@/domain/source-investment-history";
import { decimalCompare } from "@/domain/decimal";
import { shanghaiDay } from "@/domain/daily-asset-snapshots";
import type { AssetSourceSummary, InvestmentCashflow } from "@/server/ports";
import type { SourceInvestmentHistory } from "@/domain/source-investment-history";
import type { SourceInvestmentRecord } from "@/domain/source-investment-records";
import { InvestmentBookCommandError, parseInvestmentBookCommandInput } from "@/server/investment-book-errors";

export interface InvestmentBookStateStore {
  read(): InvestmentBookState | undefined;
  write(state: InvestmentBookState): void;
}

export interface InvestmentBookFacts {
  listSourcesSync(): AssetSourceSummary[];
  listSourceInvestmentHistories(): SourceInvestmentHistory[];
  listSourceInvestmentRecordsSync(): SourceInvestmentRecord[];
  listInvestmentCashflowsSync(): InvestmentCashflow[];
}

/** SQLite 与内存适配器共用同一套账本迁移、校验和更正规则。 */
export class InvestmentBookLedger {
  constructor(private readonly store: InvestmentBookStateStore, private readonly readModel: InvestmentBookFacts) {}

  stored(): InvestmentBookState | undefined {
    return this.store.read();
  }

  read(): InvestmentBookState {
    const stored = this.stored();
    const sources = this.readModel.listSourcesSync();
    const state = stored ?? migrateInvestmentBooks({
      sources, histories: this.readModel.listSourceInvestmentHistories(),
      sourceRecords: this.readModel.listSourceInvestmentRecordsSync(),
      cashflows: this.readModel.listInvestmentCashflowsSync(),
    });
    let changed = !stored;
    for (const source of sources) {
      const bookId = sourceBookId(source);
      if (bookId && !state.members.some(member => member.sourceId === source.id)) {
        state.members.push({ bookId, sourceId: source.id, fromDay: shanghaiDay(source.snapshot.syncedAt), toDay: null, confirmed: false });
        changed = true;
      } else {
        const member = state.members.find(member => member.sourceId === source.id);
        if (member && member.toDay === null && member.bookId !== bookId && member.confirmed) {
          member.confirmed = false;
          changed = true;
        }
      }
    }
    if (changed) this.write(state);
    return state;
  }
  write(state: InvestmentBookState): void {
    validateInvestmentBookState(state);
    validateBookLegacyCoverage(state, this.readModel.listInvestmentCashflowsSync());
    this.store.write(state);
  }
  private writeCommand(state: InvestmentBookState): void {
    const cashflows = this.readModel.listInvestmentCashflowsSync();
    parseInvestmentBookCommandInput(() => {
      validateInvestmentBookState(state);
      validateBookLegacyCoverage(state, cashflows);
    });
    this.store.write(state);
  }
  save(bookId: InvestmentBookId, value: unknown, capturedAt: string): void {
    const state = this.read();
    const book = parseInvestmentBookCommandInput(() => investmentBook(bookId));
    const input = parseInvestmentBookCommandInput(() => parseSourceInvestmentRecordInput(value, capturedAt));
    if (input.currency !== book.currency) throw new InvestmentBookCommandError(`本账使用 ${book.currency} 记账`);
    const raw = value as Record<string, unknown>;
    if (raw.replacesId !== undefined && (typeof raw.replacesId !== "string" ||
        !raw.replacesId.trim() || raw.replacesId.length > 10000)) throw new InvestmentBookCommandError("待更正记录标识无效");
    const replacedId = raw.replacesId as string | undefined;
    if (input.kind === "valuation" && replacedId === undefined) throw new InvestmentBookCommandError("资产金额请通过资产更新或历史导入补充");
    const note = typeof raw.note === "string" ? raw.note.trim() : "";
    if (note.length > 1000) throw new InvestmentBookCommandError("备注过长");
    const original = state.records.find(row => row.id === input.id);
    if (original) {
      if (original.bookId === bookId && !original.voidedAt && ["day", "kind", "amount", "currency"].every(key => original[key as keyof BookRecord] === input[key as keyof typeof input]) && original.note === note && original.replacesId === replacedId) return;
      throw new InvestmentBookCommandError("记录已保存，修改请创建更正记录");
    }
    if (replacedId) {
      const replaced = state.records.find(row => row.id === replacedId && row.bookId === bookId && !row.voidedAt);
      if (!replaced) throw new InvestmentBookCommandError("待更正记录不存在或已更正");
      if (replaced.kind !== input.kind) throw new InvestmentBookCommandError("更正不能改变记录类型");
      replaced.voidedAt = capturedAt;
    }
    state.records.push({ ...input, currency: book.currency, bookId, note, recordedAt: capturedAt, origin: "manual", originKey: `manual:${input.id}`, ...(replacedId ? { replacesId: replacedId } : {}) });
    this.writeCommand(state);
  }
  void(bookId: InvestmentBookId, id: string, capturedAt: string): void {
    const state = this.read();
    const row = state.records.find(row => row.id === id && row.bookId === bookId && !row.voidedAt);
    if (!row) throw new InvestmentBookCommandError("记录不存在或已作废");
    row.voidedAt = capturedAt;
    this.writeCommand(state);
  }
  import(bookId: InvestmentBookId, value: unknown): void {
    const history = parseInvestmentBookCommandInput(() => parseSourceInvestmentHistory(value));
    const book = parseInvestmentBookCommandInput(() => investmentBook(bookId));
    if (history.currency !== book.currency) throw new InvestmentBookCommandError("导入币种与账本不一致");
    const state = this.read();
    const prefix = bookHistoryPrefix(history);
    const rows = bookHistoryRecords(history, bookId);
    const existing = state.records.filter(row => row.originKey.startsWith(`${prefix}:`));
    if (existing.some(row => row.bookId !== bookId || !rows.some(next => next.id === row.id && next.day === row.day && next.kind === row.kind && next.currency === row.currency && decimalCompare(next.amount, row.amount) === 0))) throw new InvestmentBookCommandError("导入包含历史删除、改写或账本冲突");
    for (const row of rows) if (!state.records.some(old => old.id === row.id)) state.records.push(row);
    if (!state.imports.some(old => JSON.stringify(old) === JSON.stringify(history))) state.imports.push(history);
    if (history.reconciliation.asOf > shanghaiDay(new Date())) throw new InvestmentBookCommandError("不能导入未来记录");
    state.historyThroughDay[bookId] = [state.historyThroughDay[bookId] ?? "", history.reconciliation.asOf].sort().at(-1)!;
    this.writeCommand(state);
  }
  confirmMember(sourceId: string, fromDay: string, toDay: string | null): void {
    const state = this.read();
    const member = state.members.find(row => row.sourceId === sourceId);
    if (!member) throw new InvestmentBookCommandError("账本来源不存在");
    const source = this.readModel.listSourcesSync().find(source => source.id === sourceId);
    if (toDay === null && (!source || sourceBookId(source) !== member.bookId)) throw new InvestmentBookCommandError("来源已删除或类别已改变，请填写退出日期");
    if (fromDay > shanghaiDay(new Date()) || (toDay && toDay > shanghaiDay(new Date()))) throw new InvestmentBookCommandError("来源日期不能晚于今天");
    member.fromDay = fromDay;
    member.toDay = toDay;
    member.confirmed = true;
    this.writeCommand(state);
  }
  resolveLegacy(bookId: InvestmentBookId, cashflowId: string, recordId: string | null): void {
    const state = this.read();
    if (!state.unassignedLegacyIds.includes(cashflowId)) throw new InvestmentBookCommandError("旧资金记录不存在或已确认");
    const flow = this.readModel.listInvestmentCashflowsSync().find(row => row.id === cashflowId);
    if (!flow || flow.currency !== investmentBook(bookId).currency) throw new InvestmentBookCommandError("旧资金币种与账本不一致，请先核对");
    let row = recordId ? activeBookRecords(state, bookId).find(row => row.id === recordId) : undefined;
    if (row && state.legacyLinks.some(link => link.recordId === row!.id)) throw new InvestmentBookCommandError("该记录已关联另一笔旧资金，请逐笔核对");
    const kind = flow.kind === "initial-investment" && (!row || row.kind === "opening") ? "opening" : flow.kind === "external-withdrawal" ? "withdrawal" : "deposit";
    if (recordId && (!row || row.day !== shanghaiDay(flow.occurredAt) || row.kind !== kind || decimalCompare(row.amount, flow.amount) !== 0)) throw new InvestmentBookCommandError("所选关联记录与旧资金事实不一致");
    if (!row) {
      row = { id: `legacy:${flow.id}`, bookId, day: shanghaiDay(flow.occurredAt), kind, amount: flow.amount, currency: investmentBook(bookId).currency, note: flow.note ?? "", origin: "legacy", originKey: `legacy:${flow.id}`, recordedAt: flow.createdAt };
      state.records.push(row);
    }
    state.legacyLinks.push({ cashflowId, recordId: row.id });
    state.unassignedLegacyIds = state.unassignedLegacyIds.filter(id => id !== cashflowId);
    this.writeCommand(state);
  }
}
