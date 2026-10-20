import { INVESTMENT_BOOKS, type BookRecord, type InvestmentBookState } from "@/domain/investment-books";
import { getTestServices } from "@/server/composition";
import { testGuard } from "@/server/testing/route-support";

export const dynamic = "force-dynamic";

/** UI 分区验收的虚构数据；不替换默认服务，也不模拟写入成功。 */
export async function POST() {
  const denied = testGuard();
  if (denied) return denied;
  const services = getTestServices();
  await services.manualAssetRecords.create({ label: "测试证券账户" });
  const source = (await services.assetSources.list()).find(source => source.label === "测试证券账户")!;
  const flow = await services.investmentCashflows.create({
    kind: "initial-investment", occurredAt: "2025-11-30T00:00:00.000Z",
    amount: "13579", currency: "USD", note: "测试旧资金",
  });
  const records: BookRecord[] = INVESTMENT_BOOKS.flatMap(book => [
    { id: `${book.id}:opening`, bookId: book.id, day: "2025-11-30", kind: "opening", amount: "10000", currency: book.currency, note: "测试期初", recordedAt: "2025-11-30T00:00:00.000Z", origin: "manual", originKey: `${book.id}:opening` },
    ...(book.id === "a-shares" ? Array.from({ length: 25 }, (_, i): BookRecord => ({
      id: `test-deposit-${i}`, bookId: book.id, day: `2025-12-${String(i + 1).padStart(2, "0")}`,
      kind: "deposit", amount: "100", currency: book.currency, note: "测试入金",
      recordedAt: "2025-12-26T00:00:00.000Z", origin: "manual", originKey: `test-deposit-${i}`,
    })) : []),
    { id: `${book.id}:valuation`, bookId: book.id, day: "2025-12-30", kind: "valuation", amount: "15000", currency: book.currency, note: "测试估值", recordedAt: "2025-12-30T00:00:00.000Z", origin: "manual", originKey: `${book.id}:valuation` },
  ]);
  const state: InvestmentBookState = {
    version: 1, records,
    members: [{ sourceId: source.id, bookId: "a-shares", fromDay: null, toDay: null, confirmed: false }],
    legacyLinks: [], unassignedLegacyIds: [flow.id], historyThroughDay: {}, imports: [],
  };
  const readOnly = async () => { throw new Error("界面验收数据只读"); };
  services.investmentBooks = {
    readInvestmentBooks: async () => structuredClone(state),
    saveBookRecord: readOnly, voidBookRecord: readOnly, importBookHistory: readOnly,
    confirmBookMember: readOnly, resolveLegacyCashflow: readOnly,
  };
  return Response.json({ sourceId: source.id });
}
