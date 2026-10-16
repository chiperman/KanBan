"use client";

import { useState } from "react";
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
  const result = await readJsonResult<{ error?: string }>(response);
  if (lockOnUnauthorizedResponse(response)) {
    throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
  }
  if (!response.ok) throw new Error(result?.error ?? "保存类别失败");
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
  const [error, setError] = useState("");

  async function save() {
    setPending(true);
    setError("");
    try {
      await saveManualAssetClass(sourceId, assetClass === "" ? null : assetClass);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存类别失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <VibeSelectField<ManualAssetClass | "">
        disabled={pending}
        fieldId="source-manual-asset-class"
        label="资产类别"
        onValueChange={setAssetClass}
        options={MANUAL_ASSET_CLASS_OPTIONS}
        value={assetClass}
      />
      {error ? <VibeNotice role="alert" tone="error">{error}</VibeNotice> : null}
      <VibeButton
        disabled={pending || assetClass === (manualAssetClass ?? "")}
        type="submit"
        variant="outline"
      >
        {pending ? "正在保存…" : "保存类别"}
      </VibeButton>
    </form>
  );
}
