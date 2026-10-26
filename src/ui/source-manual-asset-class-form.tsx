"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ManualAssetClass } from "@/server/ports";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeSelectField, type VibeSelectOption } from "@/ui/vibe/vibe-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { lockOnUnauthorizedResponse, OWNER_SESSION_EXPIRED_MESSAGE, readJsonResult } from "@/ui/owner-request-lock";

const MANUAL_ASSET_CLASS_OPTIONS: readonly VibeSelectOption<ManualAssetClass | "">[] = [
  { value: "", label: "待分类" },
  { value: "securities", label: "证券" },
  { value: "crypto", label: "加密资产" },
  { value: "cash", label: "现金" },
  { value: "other", label: "其他投资资产" },
];

async function saveManualAssetClass(
  sourceId: string,
  manualAssetClass: ManualAssetClass | null,
) {
  const response = await fetch(
    `/api/asset-sources/${encodeURIComponent(sourceId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "manual-asset-class", manualAssetClass }),
    },
  );
  const result = await readJsonResult<{ ok?: boolean; error?: string }>(response);
  if (lockOnUnauthorizedResponse(response)) {
    throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
  }
  if (!response.ok) throw new Error(result?.error ?? "保存类别失败");
  if (result?.ok !== true) throw new Error("尚未确认类别是否保存，请刷新页面核对后再重试。");
}

export function SourceManualAssetClassForm({
  manualAssetClass,
  sourceId,
}: {
  manualAssetClass: ManualAssetClass | null;
  sourceId: string;
}) {
  const router = useRouter();
  const [assetClass, setAssetClass] = useState<ManualAssetClass | "">(
    manualAssetClass ?? "",
  );
  const [pending, setPending] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const pendingRef = useRef(false);
  const [savedClass, setSavedClass] = useState(manualAssetClass ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const busy = pending || refreshing;

  useEffect(() => { setSavedClass(manualAssetClass ?? ""); }, [manualAssetClass]);

  async function save() {
    if (pendingRef.current || busy || assetClass === savedClass) return;
    pendingRef.current = true;
    setPending(true);
    setError("");
    setSaved(false);
    try {
      await saveManualAssetClass(sourceId, assetClass === "" ? null : assetClass);
      setSavedClass(assetClass);
      setSaved(true);
      startRefresh(() => router.refresh());
    } catch (caught) {
      setError(caught instanceof TypeError ? "连接中断，尚未确认类别是否保存，请检查连接后重试。" : caught instanceof Error ? caught.message : "保存类别失败");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <form className="asset-source-detail__form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="asset-source-detail__form-row">
        <VibeSelectField<ManualAssetClass | "">
          disabled={busy}
          fieldId="source-manual-asset-class"
          label="资产类别"
          onValueChange={(value) => { setAssetClass(value); setSaved(false); }}
          options={MANUAL_ASSET_CLASS_OPTIONS}
          value={assetClass}
        />
        <VibeButton
          disabled={busy || assetClass === savedClass}
          type="submit"
          variant="outline"
        >
          {pending ? "正在保存…" : refreshing ? "正在更新…" : "保存类别"}
        </VibeButton>
      </div>
      <div role="status">{saved ? <VibeNotice tone="success">{refreshing ? "类别已保存，正在更新页面…" : "类别已保存。"}</VibeNotice> : null}</div>
      {error ? <VibeNotice role="alert" tone="error">{error}</VibeNotice> : null}
    </form>
  );
}
