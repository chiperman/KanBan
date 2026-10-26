import { shanghaiDay } from "@/domain/daily-asset-snapshots";
import { decimalCompare } from "@/domain/decimal";
import {
  activeBookRecords,
  INVESTMENT_BOOKS,
  type BookMember,
  type InvestmentBookId,
  type InvestmentBookState,
} from "@/domain/investment-books";
import type { InvestmentCashflow } from "@/server/ports";
import { AssetFinancialValue } from "@/ui/asset-financial-value";
import { VibeDateField } from "@/ui/vibe/vibe-date-field";
import { VibeSelectField } from "@/ui/vibe/vibe-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { useWorkbenchDisplayPreferences } from "@/ui/workbench-display-preferences";
import { useState } from "react";

import { ActionDialog, bookRequest } from "./action-dialog";
import { labels } from "./shared";

export function MemberDialog({
  member,
  currentDay,
  onClose,
}: {
  member: BookMember;
  currentDay: string;
  onClose(): void;
}) {
  const [fromDay, setFromDay] = useState(member.fromDay ?? "");
  const [toDay, setToDay] = useState(member.toDay ?? "");
  const [initial] = useState(() => ({ fromDay, toDay }));
  const validRange = fromDay !== "" && (toDay === "" || toDay >= fromDay);
  return (
    <ActionDialog
      checkBookId={member.bookId}
      title="确认来源范围"
      description="接入接口不会被算成新增投资。请确认该账户从哪天起包含在整本账的资产总额里。"
      dirty={fromDay !== initial.fromDay || toDay !== initial.toDay}
      onClose={onClose}
      disabled={!validRange}
      submit={() =>
        bookRequest({
          action: "member",
          bookId: member.bookId,
          sourceId: member.sourceId,
          fromDay,
          toDay: toDay || null,
        })
      }
    >
      <VibeDateField
        fieldId="book-member-from"
        label="计入资产的起始日"
        max={currentDay}
        value={fromDay}
        onValueChange={setFromDay}
      />
      <VibeDateField
        clearable
        fieldId="book-member-to"
        label="退出日（可空，当天起不再计入）"
        max={currentDay}
        value={toDay}
        onValueChange={setToDay}
      />
      {toDay !== "" && toDay < fromDay ? (
        <VibeNotice tone="error" role="alert">
          退出日不能早于起始日。
        </VibeNotice>
      ) : null}
      <p className="trend-note">
        {member.fromDay === null
          ? "现有来源此前默认全程计入；保存后将按指定起始日重新核算自动汇总。"
          : "确认前暂停汇总，避免接入账户导致资产跳变被误认为收益。"}{" "}
        导入历史的整本账总额保持原口径。
      </p>
    </ActionDialog>
  );
}
export function ResolveDialog({
  flow,
  bookId,
  state,
  onClose,
}: {
  flow: InvestmentCashflow;
  bookId: InvestmentBookId;
  state: InvestmentBookState;
  onClose(): void;
}) {
  const { showSensitiveInfo } = useWorkbenchDisplayPreferences();
  const [target, setTarget] = useState(bookId);
  const [recordId, setRecordId] = useState("");
  const matching = activeBookRecords(state, target).filter(
    (row) =>
      row.day === shanghaiDay(flow.occurredAt) &&
      row.currency === flow.currency &&
      decimalCompare(row.amount, flow.amount) === 0 &&
      (flow.kind === "initial-investment"
        ? row.kind === "opening" || row.kind === "deposit"
        : row.kind === (flow.kind === "external-withdrawal" ? "withdrawal" : "deposit")),
  );
  return (
    <ActionDialog
      checkBookId={target}
      title="确认旧资金记录归属"
      description={
        <>
          {shanghaiDay(flow.occurredAt)}，
          <AssetFinancialValue unit={flow.currency}>
            {showSensitiveInfo ? flow.amount : "••••••"}
          </AssetFinancialValue>
          ，{flow.note ?? "无备注"}
        </>
      }
      dirty={target !== bookId || recordId !== ""}
      onClose={onClose}
      submit={() =>
        bookRequest({
          action: "resolve",
          bookId: target,
          cashflowId: flow.id,
          recordId: recordId || null,
        })
      }
    >
      <VibeSelectField
        fieldId="book-resolve-target"
        label="归属账本"
        value={target}
        onValueChange={(value) => {
          setTarget(value as InvestmentBookId);
          setRecordId("");
        }}
        options={INVESTMENT_BOOKS.map((book) => ({ value: book.id, label: book.name }))}
      />
      <VibeSelectField
        fieldId="book-resolve-record"
        label="计账方式"
        value={recordId}
        onValueChange={setRecordId}
        options={[
          { value: "", label: "作为一笔独立资金计入" },
          ...matching.map((row) => ({
            value: row.id,
            label: `关联已有 ${row.day} ${labels[row.kind]} ${showSensitiveInfo ? row.amount : "••••••"} ${row.currency}，只计一次`,
          })),
        ]}
      />
      <p className="trend-note">确认这笔资金是否已包含在导入历史内。原始记录始终保留。</p>
    </ActionDialog>
  );
}
