"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SourceInvestmentRecord } from "@/domain/source-investment-records";
import type { ManualAssetRecord } from "@/server/ports";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeDateField } from "@/ui/vibe/vibe-date-field";
import { VibeDialog } from "@/ui/vibe/vibe-dialog";
import { VibeField, VibeSelectField } from "@/ui/vibe/vibe-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { lockOnUnauthorizedResponse, OWNER_SESSION_EXPIRED_MESSAGE, readJsonResult } from "@/ui/owner-request-lock";
import { CURRENCY_OPTIONS } from "@/ui/reporting-currency-options";

const kinds = [{value:"valuation",label:"资产总额"},{value:"deposit",label:"投入"},{value:"withdrawal",label:"取出"},{value:"opening",label:"期初本金"}] as const;
async function request(sourceId: string, method: "PATCH" | "DELETE", body: unknown) {
  const response = await fetch(`/api/asset-sources/${encodeURIComponent(sourceId)}`, {method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const result = await readJsonResult<{ error?: string }>(response);
  if (lockOnUnauthorizedResponse(response)) throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
  if (!response.ok) throw new Error(result?.error ?? "保存记录失败");
}

export function SourceInvestmentRecordDialog({sourceId,sourceName,currentDay,currency:fixedCurrency,defaultCurrency,hasOpening,record,manualRecord,assetOnly=false,onClose}: {
  sourceId:string; sourceName:string; currentDay:string; currency:"USD"|"CNY"|"HKD"|null; defaultCurrency:ManualAssetRecord["currency"]; hasOpening:boolean; record?:SourceInvestmentRecord; manualRecord?:ManualAssetRecord; assetOnly?:boolean; onClose():void;
}) {
  const router=useRouter();
  const [id]=useState(()=>record?.id ?? crypto.randomUUID());
  const [kind,setKind]=useState<SourceInvestmentRecord["kind"]>(record?.kind ?? "valuation");
  const [day,setDay]=useState(record?.day ?? manualRecord?.day ?? currentDay);
  const [amount,setAmount]=useState(record?.amount ?? manualRecord?.amount ?? "");
  const [currency,setCurrency]=useState(record?.currency ?? manualRecord?.currency ?? defaultCurrency);
  const usesBalanceRecord = kind === "valuation" && !record;
  const currencyLocked = !usesBalanceRecord && fixedCurrency !== null;
  const savedCurrency = currencyLocked ? fixedCurrency : currency;
  const [pending,setPending]=useState(false);
  const [error,setError]=useState("");
  async function save() {
    setPending(true); setError("");
    try {
      await request(sourceId,"PATCH",usesBalanceRecord
        ? {action:"manual-record",day,amount,currency:savedCurrency}
        : {action:"investment-record",id,day,kind,amount,currency:savedCurrency});
      router.refresh(); onClose();
    } catch (e) {setError(e instanceof Error ? e.message : "保存记录失败");}
    finally {setPending(false);}
  }
  return <VibeDialog aria-label={`记录 ${sourceName} 数据`} title={`${record || manualRecord ? "编辑记录" : "添加记录"} · ${sourceName}`} titleId="investment-record-title" eyebrow="MANUAL / RECORD"
    description={assetOnly ? "更新本来源资产总额。入金出金请到投资账本选择账本记录。" : "记录本来源的资产总额、期初本金或资金进出。"} onClose={()=>{if(!pending)onClose();}} onSubmit={e=>{e.preventDefault();void save();}}
    actions={<><VibeButton type="button" variant="text" disabled={pending} onClick={onClose}>取消</VibeButton><VibeButton type="submit" variant="primary" disabled={pending||!amount.trim()}>保存数据</VibeButton></>}>
    <VibeSelectField disabled={pending || manualRecord !== undefined || assetOnly} fieldId="investment-record-kind" label="记录类型" value={kind} onValueChange={value=>setKind(value as typeof kind)} options={kinds.filter(option=>assetOnly ? option.value==="valuation" : option.value!=="opening"||!hasOpening||record?.kind==="opening")} />
    <VibeDateField disabled={pending || manualRecord !== undefined} fieldId="investment-record-day" label="记录日期" max={currentDay} value={day} onValueChange={setDay} />
    <VibeField disabled={pending} fieldId="investment-record-amount" label={kinds.find(option=>option.value===kind)!.label} inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} />
    {currencyLocked ? <p className="trend-note">记账币种：{savedCurrency}</p> : <VibeSelectField disabled={pending} fieldId="investment-record-currency" label="币种" value={currency} onValueChange={value=>setCurrency(value as typeof currency)} options={CURRENCY_OPTIONS} />}
    <p className="trend-note">{assetOnly ? "每日仅记录一条总额，同日保存会更新已有总额；最新记录同时更新来源当前金额。历史截止日及以前请到投资账本核对导入历史，入金出金另行记录。" : kind==="opening" ? "起点的历史投入本金（非当前资产），从零开始请填 0。" : kind==="valuation" ? usesBalanceRecord ? "每日仅记录一条总额，同日保存会更新已有总额；最新记录同时更新来源当前金额。收益计算仍优先采用同日导入的资产金额。" : "此历史记录用于收益计算；来源当前金额由资产总额记录更新。同日已有导入资产金额时，计算采用导入金额。" : "仅记录实际转入/转出本金，不含买卖、分红及利息；不改变来源当前金额。"}</p>
    {error ? <VibeNotice tone="error" role="alert">{error}</VibeNotice>:null}
  </VibeDialog>;
}

export function SourceInvestmentRecordDeleteDialog({sourceName,record,onClose}:{sourceName:string;record:SourceInvestmentRecord;onClose():void}) {
  const router=useRouter(); const [pending,setPending]=useState(false); const [error,setError]=useState("");
  async function remove(){setPending(true);setError("");try{await request(record.sourceId,"DELETE",{action:"investment-record",recordId:record.id});router.refresh();onClose();}catch(e){setError(e instanceof Error?e.message:"删除失败");}finally{setPending(false);}}
  return <VibeDialog aria-label="删除手动记账记录" title="删除这条记录？" titleId="investment-record-delete-title" eyebrow="ACCOUNT / DELETE" description={`${sourceName} · ${record.day} · ${kinds.find(option=>option.value===record.kind)!.label} · ${record.amount} ${record.currency}`} onClose={()=>{if(!pending)onClose();}}
    actions={<><VibeButton type="button" variant="text" disabled={pending} onClick={onClose}>取消</VibeButton><VibeButton type="button" variant="primary" disabled={pending} onClick={()=>void remove()}>确认删除</VibeButton></>}>
    <p>删除后将重算账户收益。</p>{error?<VibeNotice tone="error" role="alert">{error}</VibeNotice>:null}
  </VibeDialog>;
}
