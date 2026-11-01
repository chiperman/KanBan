"use client";

import { useState } from "react";
import type { ManualAssetRecord } from "@/domain/manual-asset-records";
import type { InvestmentBookId } from "@/domain/investment-books";
import { FinancialRecordDialog } from "@/ui/financial-record-dialog";
import { VibeDateField } from "@/ui/vibe/vibe-date-field";
import { VibeSelectField } from "@/ui/vibe/vibe-field";
import { VibeAmountField } from "@/ui/vibe/vibe-amount-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { manualAssetRecordRequest } from "@/ui/financial-record-requests";
import { CURRENCY_OPTIONS } from "@/ui/reporting-currency-options";
import { AssetFinancialValue } from "@/ui/asset-financial-value";
import { useWorkbenchDisplayPreferences } from "@/ui/workbench-display-preferences";
import { formatShanghaiDateTime } from "@/ui/shanghai-date-time";

export function ManualAssetRecordCheck({ sourceId, sourceName, day, records }: {
  sourceId: string; sourceName: string; day: string; records: ManualAssetRecord[];
}) {
  const { showSensitiveInfo } = useWorkbenchDisplayPreferences();
  const record = records.find(row => row.sourceId === sourceId && row.day === day);
  return <div role="status"><VibeNotice tone="info">
    {sourceName}，{day}：{!showSensitiveInfo ? "金额已隐藏，请显示金额后核对。" : record ? <>
      已存资产总额 <AssetFinancialValue unit={record.currency}>{record.amount}</AssetFinancialValue>，保存于 {formatShanghaiDateTime(record.recordedAt)}。请与原窗口输入核对。
    </> : "当前未查到该日的资产总额记录，请刷新后再核对。"}
  </VibeNotice></div>;
}

export function ManualAssetRecordDialog({sourceId,sourceName,currentDay,defaultCurrency,record,checkBookId,onClose}: {
  sourceId:string; sourceName:string; currentDay:string; defaultCurrency:ManualAssetRecord["currency"]; record?:ManualAssetRecord; checkBookId?:InvestmentBookId; onClose():void;
}) {
  const [day,setDay]=useState(record?.day ?? currentDay);
  const [amount,setAmount]=useState(record?.amount ?? "");
  const [currency,setCurrency]=useState(record?.currency ?? defaultCurrency);
  const checkQuery = new URLSearchParams({ recordDay: day, recordFilter: "valuations", recordSource: sourceId });
  const checkHref = checkBookId
    ? `/performance?book=${checkBookId}&view=records&${checkQuery}`
    : `/asset-sources/${encodeURIComponent(sourceId)}?interval=custom&from=${encodeURIComponent(day)}&to=${encodeURIComponent(day)}&checkDay=${encodeURIComponent(day)}`;
  const [initial] = useState(() => ({ day, amount, currency }));
  const dirty = day !== initial.day || amount !== initial.amount || currency !== initial.currency;
  return <FinancialRecordDialog ariaLabel={`记录 ${sourceName} 数据`} title={`${record ? "编辑记录" : "添加记录"}，${sourceName}`} titleId="investment-record-title"
    dirty={dirty} onClose={onClose} checkHref={checkHref} button="保存数据"
    submit={signal => manualAssetRecordRequest(sourceId, {day,amount,currency}, signal)}>
    <VibeSelectField disabled fieldId="investment-record-kind" label="记录类型" value="valuation" onValueChange={() => {}} options={[{value:"valuation",label:"资产总额"}]} />
    <VibeDateField disabled={record !== undefined} fieldId="investment-record-day" label="记录日期" max={currentDay} value={day} onValueChange={setDay} />
    <VibeAmountField fieldId="investment-record-amount" label="资产总额" kind="balance" value={amount} onValueChange={setAmount} />
    <VibeSelectField fieldId="investment-record-currency" label="币种" value={currency} onValueChange={value=>setCurrency(value as typeof currency)} options={CURRENCY_OPTIONS} />
    <p className="trend-note">每日仅记录一条总额，同日保存会更新已有总额；最新记录同时更新来源当前金额。历史截止日及以前请到投资账本核对导入历史，入金出金另行记录。</p>
  </FinancialRecordDialog>;
}
