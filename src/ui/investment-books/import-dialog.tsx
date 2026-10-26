import { investmentBook, type InvestmentBookId } from "@/domain/investment-books";
import { parseSourceInvestmentHistory } from "@/domain/source-investment-history";
import { AssetFinancialValue } from "@/ui/asset-financial-value";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeTextAreaField } from "@/ui/vibe/vibe-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { useWorkbenchDisplayPreferences } from "@/ui/workbench-display-preferences";
import { useState } from "react";

import { ActionDialog, bookRequest } from "./action-dialog";
import { bookMoney } from "./shared";

export function ImportDialog({ bookId, onClose }: { bookId: InvestmentBookId; onClose(): void }) {
  const { showSensitiveInfo } = useWorkbenchDisplayPreferences();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ReturnType<typeof parseSourceInvestmentHistory> | null>(
    null,
  );
  const [error, setError] = useState("");
  function inspect() {
    try {
      const history = parseSourceInvestmentHistory(JSON.parse(text));
      if (history.currency !== investmentBook(bookId).currency) throw new Error("币种与本账不一致");
      setPreview(history);
      setError("");
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : "导入格式无效");
    }
  }
  return (
    <ActionDialog
      checkBookId={bookId}
      title={`导入历史，${investmentBook(bookId).name}`}
      description="导入已有的投资账本 JSON。先核对截止日、本金和资产；重复导入同一原件不会重复计账。"
      dirty={text !== ""}
      onClose={onClose}
      disabled={!preview}
      button="确认导入"
      submit={() => bookRequest({ action: "import", bookId, history: preview })}
    >
      <VibeTextAreaField
        fieldId="book-import-json"
        label="历史数据 JSON"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPreview(null);
        }}
        rows={6}
      />
      <VibeButton type="button" variant="outline" onClick={inspect}>
        核对导入数据
      </VibeButton>
      {error ? (
        <VibeNotice tone="error" role="alert">
          {error}
        </VibeNotice>
      ) : null}
      {preview ? (
        <VibeNotice tone="info">
          {preview.accountName}，{preview.records.length} 条，截至 {preview.reconciliation.asOf}
          <br />
          净投入{" "}
          <AssetFinancialValue unit={preview.currency}>
            {showSensitiveInfo ? bookMoney(preview.reconciliation.netInvestment) : "••••••"}
          </AssetFinancialValue>{" "}
          / 资产{" "}
          <AssetFinancialValue unit={preview.currency}>
            {showSensitiveInfo ? bookMoney(preview.reconciliation.total) : "••••••"}
          </AssetFinancialValue>{" "}
          / 收益{" "}
          <AssetFinancialValue unit={preview.currency}>
            {showSensitiveInfo ? bookMoney(preview.reconciliation.profit) : "••••••"}
          </AssetFinancialValue>
        </VibeNotice>
      ) : null}
      <p className="trend-note">
        {bookId === "crypto"
          ? "有导入资产记录的日期优先采用历史总额，其余日期采用当天完整自动同步，不跨日补值或叠加。"
          : "历史总额与后续同步按截止日衔接，不叠加。"}
        发现原件被改写、缺失或账本冲突时会拒绝导入。
      </p>
    </ActionDialog>
  );
}
