import type { InvestmentBookId, InvestmentBookState, InvestmentBookStore } from "@/domain/investment-books";
import { InvestmentBookLedger } from "@/server/investment-books";
import type {
  AssetSourceDetailQuery,
  AssetSourceDetails,
  AssetSources,
  DailyAssetSnapshots,
  DailyAssetTrendObservation,
  InvestmentCashflows,
  ManualAssetRecords,
} from "@/server/ports";

export class InMemoryAssetSourceDetails implements AssetSourceDetails {
  constructor(
    private readonly sources: AssetSources,
    private readonly manualRecords: ManualAssetRecords,
    private readonly snapshots: DailyAssetSnapshots,
  ) {}

  async readSourceDetail(query: AssetSourceDetailQuery) {
    const [sources, manualRecords, history, imported] = await Promise.all([
      this.sources.list(), this.manualRecords.list(),
      this.snapshots.listTrendObservations(), this.snapshots.listImportedSourceHistoryObservations(),
    ]);
    const records = manualRecords.filter(row => row.sourceId === query.sourceId);
    const observations = history
      .filter(row => row.sources.some(source => source.sourceId === query.sourceId))
      .map(row => ({ ...row, sources: row.sources.filter(source => source.sourceId === query.sourceId) }));
    const sourceHistory = imported.filter(row => row.sourceId === query.sourceId && row.kind === "longbridge");
    const byDay = new Map<string, DailyAssetTrendObservation>(observations.map(row => [row.day, row]));
    for (const row of sourceHistory) {
      byDay.set(row.day, { day: row.day, capturedAt: row.capturedAt, complete: false, status: "incomplete", total: row.total, sources: [row] });
    }
    return structuredClone({
      sources,
      manualRecords: records,
      history: [...byDay.values()]
        .filter(row => (!query.from || row.day >= query.from) && (!query.to || row.day <= query.to))
        .sort((a, b) => a.day.localeCompare(b.day)),
      firstDay: [...observations, ...sourceHistory, ...records].map(row => row.day).sort()[0],
      investmentHistory: null,
      investmentRecords: [],
    });
  }

  async listSourceInvestmentHistories() { return []; }
  async listSourceInvestmentRecords() { return []; }
  async saveSourceInvestmentRecord(): Promise<void> {
    throw new Error("资金记账已统一到三本账，请到投资账本中选择账本操作");
  }
  async deleteSourceInvestmentRecord(): Promise<void> {
    throw new Error("资金记账已统一到三本账，请到投资账本中选择账本操作");
  }
}

export class InMemoryInvestmentBooks implements InvestmentBookStore {
  private state: InvestmentBookState | undefined;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly sources: AssetSources,
    private readonly cashflows: InvestmentCashflows,
    private readonly details: AssetSourceDetails,
  ) {}

  private run<T>(operation: (ledger: InvestmentBookLedger) => T): Promise<T> {
    const result = this.pending.then(async () => {
      const [sources, cashflows, histories, sourceRecords] = await Promise.all([
        this.sources.list(), this.cashflows.list(),
        this.details.listSourceInvestmentHistories(), this.details.listSourceInvestmentRecords(),
      ]);
      let state = structuredClone(this.state);
      const ledger = new InvestmentBookLedger({
        read: () => structuredClone(state),
        write: next => { state = structuredClone(next); },
      }, {
        listSourcesSync: () => sources,
        listInvestmentCashflowsSync: () => cashflows,
        listSourceInvestmentHistories: () => histories,
        listSourceInvestmentRecordsSync: () => sourceRecords,
      });
      // 与 SQLite 事务一致：串行执行，失败时不提交本次状态。
      const value = operation(ledger);
      this.state = state;
      return value;
    });
    this.pending = result.catch(() => undefined);
    return result;
  }

  readInvestmentBooks() { return this.run(ledger => ledger.read()); }
  saveBookRecord(bookId: InvestmentBookId, value: unknown, capturedAt: string) {
    return this.run(ledger => ledger.save(bookId, value, capturedAt));
  }
  voidBookRecord(bookId: InvestmentBookId, id: string, capturedAt: string) {
    return this.run(ledger => ledger.void(bookId, id, capturedAt));
  }
  importBookHistory(bookId: InvestmentBookId, value: unknown) {
    return this.run(ledger => ledger.import(bookId, value));
  }
  confirmBookMember(sourceId: string, fromDay: string, toDay: string | null) {
    return this.run(ledger => ledger.confirmMember(sourceId, fromDay, toDay));
  }
  resolveLegacyCashflow(bookId: InvestmentBookId, cashflowId: string, recordId: string | null) {
    return this.run(ledger => ledger.resolveLegacy(bookId, cashflowId, recordId));
  }
}
