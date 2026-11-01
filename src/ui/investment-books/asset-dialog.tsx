import { assetSourceDisplayName } from "@/domain/asset-source-display-name";
import { type InvestmentBookState } from "@/domain/investment-books";
import type { ManualAssetRecord } from "@/server/ports";
import { bookRequest } from "@/ui/financial-record-requests";
import { VibeAmountField } from "@/ui/vibe/vibe-amount-field";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeDateField } from "@/ui/vibe/vibe-date-field";
import { VibeSelectField } from "@/ui/vibe/vibe-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { useState } from "react";

import { ActionDialog } from "./action-dialog";
import { type InvestmentBookSource } from "./shared";

export function AssetDialog({
  currentDay,
  initialDay,
  state,
  sources,
  manualRecords,
  onClose,
}: {
  currentDay: string;
  initialDay?: string;
  state: InvestmentBookState;
  sources: InvestmentBookSource[];
  manualRecords: ManualAssetRecord[];
  onClose(): void;
}) {
  const members = state.members.filter(
    (row) => row.bookId === "a-shares" && row.confirmed && !row.toDay,
  );
  const [sourceId, setSourceId] = useState(members[0]?.sourceId ?? "");
  const selectedMember = members.find((row) => row.sourceId === sourceId);
  const [day, setDay] = useState(initialDay ?? currentDay);
  const savedAmount = (id: string, date: string) =>
    manualRecords.find((row) => row.sourceId === id && row.day === date)?.amount ?? "";
  const [amount, setAmount] = useState(() => savedAmount(sourceId, day));
  const [originalAmount, setOriginalAmount] = useState(amount);
  const [selection, setSelection] = useState<{
    sourceId: string;
    day: string;
  } | null>(null);
  const dirty = amount !== originalAmount;
  function switchSelection(id: string, date: string) {
    setSourceId(id);
    setDay(date);
    const saved = savedAmount(id, date);
    setAmount(saved);
    setOriginalAmount(saved);
    setSelection(null);
  }
  function requestSelection(id: string, date: string) {
    if (id === sourceId && date === day) return;
    if (dirty) setSelection({ sourceId: id, day: date });
    else switchSelection(id, date);
  }
  function cancelSelection() {
    setSelection(null);
  }
  return (
    <ActionDialog
      confirmation={selection ? {
        title: "放弃当前金额修改？",
        description: "切换后将显示所选来源与日期已保存的金额。",
        onCancel: cancelSelection,
        actions: (
          <>
            <VibeButton type="button" variant="text" onClick={cancelSelection}>
              继续编辑
            </VibeButton>
            <VibeButton
              type="button"
              tone="danger"
              onClick={() => switchSelection(selection.sourceId, selection.day)}
            >
              放弃并切换
            </VibeButton>
          </>
        ),
      } : undefined}
      checkBookId="a-shares"
      checkHref={`/performance?book=a-shares&view=records&recordFilter=valuations&recordDay=${encodeURIComponent(day)}&recordSource=${encodeURIComponent(sourceId)}`}
      title="更新A股资产"
      description="每周日填写当天的资产总额，包含持仓和账户现金。同日保存会更新已有金额。"
      dirty={dirty}
      onClose={onClose}
      disabled={!selectedMember}
      submit={(signal) =>
        bookRequest({ action: "asset", bookId: "a-shares", sourceId, day, amount, currency: "CNY" }, signal)
      }
    >
      <VibeSelectField
        fieldId="book-asset-source"
        label="资产来源"
        value={sourceId}
        onValueChange={(id) => requestSelection(id, day)}
        options={members.map((row) => {
          const source = sources.find((source) => source.id === row.sourceId);
          return {
            value: row.sourceId,
            label: source ? assetSourceDisplayName(source) : row.sourceId,
          };
        })}
      />
      <VibeDateField
        fieldId="book-asset-day"
        label="资产日期"
        max={currentDay}
        value={day}
        onValueChange={(date) => requestSelection(sourceId, date)}
      />
      <VibeAmountField
        key={`${sourceId}/${day}`}
        fieldId="book-asset-amount"
        label="当天资产总额（CNY）"
        value={amount}
        onValueChange={setAmount}
      />
      {sourceId && !selectedMember ? (
        <VibeNotice role="status" tone="warning">所选来源已不在当前账本范围，请重新选择资产来源。</VibeNotice>
      ) : members.length === 0 ? (
        <VibeNotice tone="info">请先在资产页接入手工证券来源，并在本页确认来源范围。</VibeNotice>
      ) : null}
      <p className="trend-note">此处只更新资产金额。新增投入或取出资金，请另记入金或出金。</p>
    </ActionDialog>
  );
}
