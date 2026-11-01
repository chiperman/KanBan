import {
  activeBookRecords,
  INVESTMENT_BOOKS,
  investmentBook,
  type BookRecord,
  type InvestmentBookId,
  type InvestmentBookState,
} from "@/domain/investment-books";
import { bookRequest } from "@/ui/financial-record-requests";
import { VibeAmountField } from "@/ui/vibe/vibe-amount-field";
import { VibeDateField } from "@/ui/vibe/vibe-date-field";
import { VibeField, VibeSelectField } from "@/ui/vibe/vibe-field";
import { useState } from "react";

import { ActionDialog } from "./action-dialog";
import { labels } from "./shared";

export function FundDialog({
  initialBookId,
  currentDay,
  state,
  record,
  onClose,
}: {
  initialBookId: InvestmentBookId;
  currentDay: string;
  state: InvestmentBookState;
  record?: BookRecord;
  onClose(): void;
}) {
  const [bookId, setBookId] = useState(initialBookId);
  const [id] = useState(() => crypto.randomUUID());
  const [kind, setKind] = useState<BookRecord["kind"]>(record?.kind ?? "deposit");
  const [day, setDay] = useState(record?.day ?? currentDay);
  const [amount, setAmount] = useState(record?.amount ?? "");
  const [note, setNote] = useState(record?.note ?? "");
  const [initial] = useState(() => ({ bookId: initialBookId, kind, day, amount, note }));
  const dirty =
    bookId !== initial.bookId ||
    kind !== initial.kind ||
    day !== initial.day ||
    amount !== initial.amount ||
    note !== initial.note;
  const book = investmentBook(bookId);
  const hasOpening = activeBookRecords(state, bookId).some((row) => row.kind === "opening");
  return (
    <ActionDialog
      checkBookId={bookId}
      checkHref={`/performance?book=${bookId}&view=records&recordFilter=${kind === "valuation" ? "valuations" : "funds"}&recordDay=${encodeURIComponent(day)}`}
      title={record ? "更正记账记录" : "记录出入金"}
      description={record ? "更正后重算收益，原记录保留。" : undefined}
      dirty={dirty}
      onClose={onClose}
      submit={(signal) =>
        bookRequest({
          action: "save",
          bookId,
          record: {
            id,
            day,
            amount,
            currency: book.currency,
            kind,
            note,
            ...(record ? { replacesId: record.id } : {}),
          },
        }, signal)
      }
    >
      <VibeSelectField
        fieldId="book-fund-book"
        label="账本"
        value={bookId}
        disabled={!!record}
        options={INVESTMENT_BOOKS.map((book) => ({
          value: book.id,
          label: `${book.name}（${book.currency}）`,
        }))}
        onValueChange={(value) => {
          setBookId(value as InvestmentBookId);
          setKind("deposit");
        }}
      />
      <VibeSelectField
        fieldId="book-fund-kind"
        label="记录类型"
        value={kind}
        disabled={!!record}
        onValueChange={(value) => setKind(value as typeof kind)}
        options={Object.entries(labels)
          .filter(([key]) =>
            record
              ? key === record.kind
              : key !== "valuation" && (key !== "opening" || !hasOpening),
          )
          .map(([value, label]) => ({ value, label }))}
      />
      <VibeDateField
        fieldId="book-fund-day"
        label="发生日期"
        max={currentDay}
        value={day}
        onValueChange={setDay}
      />
      <VibeAmountField
        fieldId="book-fund-amount"
        label={`${labels[kind]}（${book.currency}）`}
        kind={kind}
        value={amount}
        onValueChange={setAmount}
      />
      <VibeField
        fieldId="book-fund-note"
        label="备注"
        maxLength={1000}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <p className="trend-note">
        {kind === "opening"
          ? "填写历史起点时累计投入的本金，不是今天的资产余额；从零开始填 0。之后的入金出金要逐笔补齐，收益率从这个日期开始计算。"
          : kind === "valuation"
            ? "更正这一天的历史总资产，不改变本金。"
            : "资金记录不改变资产余额。买卖、分红和同一本账内账户互转都不属于入金出金。"}
      </p>
      {bookId === "crypto" ? (
        <p className="trend-note">虚拟货币按整体记账，无需选择交易所或钱包，不分摊历史本金。</p>
      ) : null}
    </ActionDialog>
  );
}
