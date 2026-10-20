import { investmentBook } from "@/domain/investment-books";
import { parseManualAssetRecordInput } from "@/domain/manual-asset-records";
import { getServices } from "@/server/composition";

export const dynamic = "force-dynamic";

export async function GET() {
  const services = getServices();
  if (!(await services.auth.currentSession())) return Response.json({ error: "需要所有者身份" }, { status: 401 });
  if (!services.investmentBooks) return Response.json({ error: "账本服务不可用" }, { status: 503 });
  return Response.json({ state: await services.investmentBooks.readInvestmentBooks() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    return Response.json({ error: "请求来源不匹配" }, { status: 403 });
  }
  const services = getServices();
  if (!(await services.auth.currentSession())) return Response.json({ error: "需要所有者身份" }, { status: 401 });
  const store = services.investmentBooks;
  if (!store) return Response.json({ error: "账本服务不可用" }, { status: 503 });
  const body = await request.json().catch(() => null);
  try {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("账本操作无效");
    const book = investmentBook(body.bookId);
    const capturedAt = services.clock.now().toISOString();
    switch (body.action) {
      case "save":
        if (body.record?.kind === "valuation" && !body.record?.replacesId) throw new Error("资产金额请使用更新资产入口");
        await store.saveBookRecord(book.id, body.record, capturedAt);
        break;
      case "void":
        if (typeof body.id !== "string" || body.confirmation !== "VOID_RECORD") throw new Error("请明确确认作废记录");
        await store.voidBookRecord(book.id, body.id, capturedAt);
        break;
      case "import":
        await store.importBookHistory(book.id, body.history);
        break;
      case "member": {
        const state = await store.readInvestmentBooks();
        if (!state.members.some(row => row.sourceId === body.sourceId && row.bookId === book.id)) throw new Error("账本来源不匹配");
        if (typeof body.fromDay !== "string" || (body.toDay !== null && typeof body.toDay !== "string")) throw new Error("来源范围日期无效");
        await store.confirmBookMember(body.sourceId, body.fromDay, body.toDay);
        break;
      }
      case "resolve":
        if (typeof body.cashflowId !== "string" || (body.recordId !== null && typeof body.recordId !== "string")) throw new Error("旧资金关联无效");
        await store.resolveLegacyCashflow(book.id, body.cashflowId, body.recordId);
        break;
      case "asset": {
        if (book.automatic) throw new Error("本账资产通过自动同步更新");
        const input = parseManualAssetRecordInput(body);
        const state = await store.readInvestmentBooks();
        const member = state.members.find(row => row.sourceId === body.sourceId && row.bookId === book.id);
        if (!member?.confirmed || (member.fromDay && member.fromDay > input.day) || (member.toDay && input.day >= member.toDay)) throw new Error("所选来源不在当天账本范围内");
        if (input.currency !== book.currency) throw new Error("资产币种与账本不一致");
        if (state.historyThroughDay[book.id] && input.day <= state.historyThroughDay[book.id]!) throw new Error("该日期由导入历史覆盖，请核对原始记录；新资产记录请选历史截止日之后");
        await services.manualAssetRecords.record(member.sourceId, input);
        break;
      }
      default: throw new Error("账本操作无效");
    }
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "账本保存失败" }, { status: 400 });
  }
}
