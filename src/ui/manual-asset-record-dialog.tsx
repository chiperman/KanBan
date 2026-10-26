"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ManualAssetRecord } from "@/domain/manual-asset-records";
import type { InvestmentBookId } from "@/domain/investment-books";
import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
import { VibeDateField } from "@/ui/vibe/vibe-date-field";
import { VibeDialog } from "@/ui/vibe/vibe-dialog";
import { VibeSelectField } from "@/ui/vibe/vibe-field";
import { VibeAmountField } from "@/ui/vibe/vibe-amount-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { lockOnUnauthorizedResponse, OWNER_SESSION_EXPIRED_MESSAGE, readJsonResult } from "@/ui/owner-request-lock";
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

class RecordSaveOutcomeUnknown extends Error {
  constructor() { super("尚未确认保存结果。请在新标签页核对最新记录，确认未保存后再重试；当前输入已保留。"); }
}
async function saveManualRecord(sourceId: string, body: unknown) {
  let response: Response;
  try {
    response = await fetch(`/api/asset-sources/${encodeURIComponent(sourceId)}`, {method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  } catch {
    throw new RecordSaveOutcomeUnknown();
  }
  const result = await readJsonResult<{ ok?: boolean; error?: string }>(response);
  if (lockOnUnauthorizedResponse(response)) throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
  if (response.status >= 500 || (response.ok && result?.ok !== true)) throw new RecordSaveOutcomeUnknown();
  if (!response.ok) throw new Error(result?.error ?? "保存记录失败");
}

export function ManualAssetRecordDialog({sourceId,sourceName,currentDay,defaultCurrency,record,checkBookId,onClose}: {
  sourceId:string; sourceName:string; currentDay:string; defaultCurrency:ManualAssetRecord["currency"]; record?:ManualAssetRecord; checkBookId?:InvestmentBookId; onClose():void;
}) {
  const router=useRouter();
  const [day,setDay]=useState(record?.day ?? currentDay);
  const [amount,setAmount]=useState(record?.amount ?? "");
  const [currency,setCurrency]=useState(record?.currency ?? defaultCurrency);
  const checkQuery = new URLSearchParams({ recordDay: day, recordFilter: "valuations", recordSource: sourceId });
  const checkHref = checkBookId
    ? `/performance?book=${checkBookId}&view=records&${checkQuery}`
    : `/asset-sources/${encodeURIComponent(sourceId)}?interval=custom&from=${encodeURIComponent(day)}&to=${encodeURIComponent(day)}&checkDay=${encodeURIComponent(day)}`;
  const [initial] = useState(() => ({ day, amount, currency }));
  const dirty = day !== initial.day || amount !== initial.amount || currency !== initial.currency;
  const [pending,setPending]=useState(false);
  const pendingRef = useRef(false);
  const [needsCheck, setNeedsCheck] = useState(false);
  const needsCheckRef = useRef(false);
  const [error,setError]=useState("");
  async function save() {
    if (pendingRef.current || needsCheckRef.current) return;
    pendingRef.current = true;
    setPending(true); setError("");
    try {
      await saveManualRecord(sourceId, {action:"manual-record",day,amount,currency});
      router.refresh(); onClose();
    } catch (e) {
      if (e instanceof RecordSaveOutcomeUnknown) { needsCheckRef.current = true; setNeedsCheck(true); }
      setError(e instanceof Error ? e.message : "保存记录失败");
    }
    finally {pendingRef.current = false; setPending(false);}
  }
  return <VibeDialog aria-label={`记录 ${sourceName} 数据`} title={`${record ? "编辑记录" : "添加记录"}，${sourceName}`} titleId="investment-record-title"
    dirty={dirty || needsCheck} pending={pending} onClose={onClose} onSubmit={e=>{e.preventDefault();void save();}}
    actions={requestClose => <><VibeButton type="button" variant="text" disabled={pending} onClick={requestClose}>取消</VibeButton>{needsCheck ? <>
      <VibeLink href={checkHref} target="_blank" rel="noreferrer" variant="outline">核对最新记录（新标签页）</VibeLink>
      <VibeButton type="button" variant="text" onClick={() => { needsCheckRef.current = false; setNeedsCheck(false); setError(""); }}>已确认未保存，继续编辑</VibeButton>
    </> : <VibeButton type="submit" variant="primary" disabled={pending}>{pending ? "保存中…" : "保存数据"}</VibeButton>}</>}>
    <VibeSelectField disabled fieldId="investment-record-kind" label="记录类型" value="valuation" onValueChange={() => {}} options={[{value:"valuation",label:"资产总额"}]} />
    <VibeDateField disabled={pending || needsCheck || record !== undefined} fieldId="investment-record-day" label="记录日期" max={currentDay} value={day} onValueChange={setDay} />
    <VibeAmountField disabled={pending || needsCheck} fieldId="investment-record-amount" label="资产总额" kind="balance" value={amount} onValueChange={setAmount} />
    <VibeSelectField disabled={pending || needsCheck} fieldId="investment-record-currency" label="币种" value={currency} onValueChange={value=>setCurrency(value as typeof currency)} options={CURRENCY_OPTIONS} />
    <p className="trend-note">每日仅记录一条总额，同日保存会更新已有总额；最新记录同时更新来源当前金额。历史截止日及以前请到投资账本核对导入历史，入金出金另行记录。</p>
    {error ? <VibeNotice tone="error" role="alert">{error}</VibeNotice>:null}
  </VibeDialog>;
}
