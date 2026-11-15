import { investmentBook } from "@/domain/investment-books";
import { getServices } from "@/server/composition";
import { rejectCrossOrigin } from "@/server/auth/request-origin";
import { InvestmentBookCommandError, isInvestmentBookValuationConflict, parseInvestmentBookCommandInput } from "@/server/investment-book-errors";

export const dynamic = "force-dynamic";

export async function GET() {
  const services = getServices();
  if (!(await services.auth.currentSession())) return Response.json({ error: "需要所有者身份" }, { status: 401 });
  if (!services.investmentBooks) return Response.json({ error: "账本服务不可用" }, { status: 503 });
  return Response.json({ state: await services.investmentBooks.readInvestmentBooks() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const services = getServices();
  if (!(await services.auth.currentSession())) return Response.json({ error: "需要所有者身份" }, { status: 401 });
  const store = services.investmentBooks;
  if (!store) return Response.json({ error: "账本服务不可用" }, { status: 503 });
  const body = await request.json().catch(() => null);
  try {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new InvestmentBookCommandError("账本操作无效");
    const book = parseInvestmentBookCommandInput(() => investmentBook(body.bookId));
    const capturedAt = services.clock.now().toISOString();
    switch (body.action) {
      case "save":
        if (body.record?.kind === "valuation" && !body.record?.replacesId) throw new InvestmentBookCommandError("资产金额请使用更新资产入口");
        await store.saveBookRecord(book.id, body.record, capturedAt);
        break;
      case "void":
        if (typeof body.id !== "string" || body.confirmation !== "VOID_RECORD") throw new InvestmentBookCommandError("请明确确认作废记录");
        await store.voidBookRecord(book.id, body.id, capturedAt);
        break;
      case "import":
        await store.importBookHistory(book.id, body.history, body.valuationChoices, capturedAt);
        break;
      case "member": {
        const state = await store.readInvestmentBooks();
        if (!state.members.some(row => row.sourceId === body.sourceId && row.bookId === book.id)) throw new InvestmentBookCommandError("账本来源不匹配");
        if (typeof body.fromDay !== "string" || (body.toDay !== null && typeof body.toDay !== "string")) throw new InvestmentBookCommandError("来源范围日期无效");
        await store.confirmBookMember(body.sourceId, body.fromDay, body.toDay);
        break;
      }
      case "resolve":
        if (typeof body.cashflowId !== "string" || (body.recordId !== null && typeof body.recordId !== "string")) throw new InvestmentBookCommandError("旧资金关联无效");
        await store.resolveLegacyCashflow(book.id, body.cashflowId, body.recordId);
        break;
      case "asset": {
        if (book.automatic) throw new InvestmentBookCommandError("本账资产通过自动同步更新");
        if (typeof body.sourceId !== "string") throw new InvestmentBookCommandError("资产来源无效");
        await store.saveBookAsset(body.sourceId, body, capturedAt, body.valuationChoices);
        break;
      }
      default: throw new InvestmentBookCommandError("账本操作无效");
    }
    return Response.json({ ok: true });
  } catch (error) {
    if (isInvestmentBookValuationConflict(error)) {
      return Response.json({ error: error.message, valuationConflicts: error.conflicts }, { status: 409 });
    }
    const rejected = error instanceof InvestmentBookCommandError;
    return Response.json(
      { error: rejected ? error.message : "尚未确认账本保存结果，请先核对最新记录" },
      { status: rejected ? 400 : 500 },
    );
  }
}
