"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SourceInvestmentRecord } from "@/domain/source-investment-records";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeDateField } from "@/ui/vibe/vibe-date-field";
import { VibeDialog } from "@/ui/vibe/vibe-dialog";
import { VibeField, VibeSelectField } from "@/ui/vibe/vibe-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { lockOnUnauthorizedResponse, OWNER_SESSION_EXPIRED_MESSAGE, readJsonResult } from "@/ui/owner-request-lock";

const kinds = [{value:"valuation",label:"当天资产金额"},{value:"deposit",label:"投入"},{value:"withdrawal",label:"取出"},{value:"opening",label:"期初本金"}] as const;
async function request(sourceId: string, method: "PATCH" | "DELETE", body: unknown) {
  const response = await fetch(`/api/asset-sources/${encodeURIComponent(sourceId)}`, {method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const result = await readJsonResult<{ error?: string }>(response);
  if (lockOnUnauthorizedResponse(response)) throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
  if (!response.ok) throw new Error(result?.error ?? "保存记录失败");
}

export function SourceInvestmentRecordDialog({sourceId,sourceName,currentDay,currency:fixedCurrency,hasOpening,record,onClose}: {
  sourceId:string; sourceName:string; currentDay:string; currency:"USD"|"CNY"|"HKD"|null; hasOpening:boolean; record?:SourceInvestmentRecord; onClose():void;
}) {
  const router=useRouter();
  const [id]=useState(()=>record?.id ?? crypto.randomUUID());
  const [kind,setKind]=useState<SourceInvestmentRecord["kind"]>(record?.kind ?? (hasOpening ? "valuation" : "opening"));
  const [day,setDay]=useState(record?.day ?? currentDay);
  const [amount,setAmount]=useState(record?.amount ?? "");
  const [currency,setCurrency]=useState(record?.currency ?? fixedCurrency ?? "USD");
  const [pending,setPending]=useState(false);
  const [error,setError]=useState("");
  async function save() {
    setPending(true); setError("");
    try {
      await request(sourceId,"PATCH",{action:"investment-record",id,day,kind,amount,currency});
      router.refresh(); onClose();
    } catch (e) {setError(e instanceof Error ? e.message : "保存记录失败");}
    finally {setPending(false);}
  }
  return <VibeDialog aria-label={`${record ? "编辑" : "手动记录"}${sourceName}`} title={`${record ? "编辑" : "手动记录"} · ${sourceName}`} titleId="investment-record-title" eyebrow="ACCOUNT / RECORD"
    description="仅记录本账户的资金进出或资产金额。" onClose={()=>{if(!pending)onClose();}} onSubmit={e=>{e.preventDefault();void save();}}
    actions={<><VibeButton type="button" variant="text" disabled={pending} onClick={onClose}>取消</VibeButton><VibeButton type="submit" variant="primary" disabled={pending||!amount.trim()}>保存记录</VibeButton></>}>
    <VibeSelectField fieldId="investment-record-kind" label="记录类型" value={kind} onValueChange={value=>setKind(value as typeof kind)} options={kinds.filter(option=>option.value!=="opening"||!hasOpening||record?.kind==="opening")} />
    <VibeDateField fieldId="investment-record-day" label="记录日期" max={currentDay} value={day} onValueChange={setDay} />
    <VibeField fieldId="investment-record-amount" label={kinds.find(option=>option.value===kind)!.label} inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} />
    {fixedCurrency ? <p className="trend-note">记账币种：{fixedCurrency}</p> : <VibeSelectField fieldId="investment-record-currency" label="币种" value={currency} onValueChange={value=>setCurrency(value as typeof currency)} options={[{value:"USD",label:"USD"},{value:"CNY",label:"CNY"},{value:"HKD",label:"HKD"}]} />}
    <p className="trend-note">{kind==="opening" ? "起点的历史投入本金（非当前资产），从零开始请填 0。" : kind==="valuation" ? "记录指定日期的账户总资产。自动刷新会保留此记录；同日已有有知有行金额时，计算采用有知有行。" : "仅记录实际转入/转出本金，不含买卖、分红及利息。"}</p>
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
