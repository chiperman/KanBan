"use client";

import type { ManualAssetClass } from "@/server/ports";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeSelectField, type VibeSelectOption } from "@/ui/vibe/vibe-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { useSourceSettingDraft } from "@/ui/use-source-setting-draft";
import { AssetSourceCommandFeedback, useAssetSourceCommand } from "@/ui/asset-source-command";

const MANUAL_ASSET_CLASS_OPTIONS: readonly VibeSelectOption<ManualAssetClass | "">[] = [
  { value: "", label: "待分类" },
  { value: "securities", label: "证券" },
  { value: "crypto", label: "加密资产" },
  { value: "cash", label: "现金" },
  { value: "other", label: "其他投资资产" },
];

export function SourceManualAssetClassForm({
  manualAssetClass,
  sourceId,
}: {
  manualAssetClass: ManualAssetClass | null;
  sourceId: string;
}) {
  const {
    value: assetClass,
    dirty,
    saved,
    setValue: setAssetClass,
    markSaved,
  } = useSourceSettingDraft<ManualAssetClass | "">(manualAssetClass ?? "");
  const saving = useAssetSourceCommand();

  async function save() {
    if (!dirty) return;
    await saving.run(sourceId, {
      action: "manual-asset-class",
      manualAssetClass: assetClass === "" ? null : assetClass,
    }, () => markSaved(assetClass));
  }

  return (
    <form className="asset-source-detail__form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="asset-source-detail__form-row">
        <VibeSelectField<ManualAssetClass | "">
          disabled={saving.blocked}
          fieldId="source-manual-asset-class"
          label="资产类别"
          onValueChange={setAssetClass}
          options={MANUAL_ASSET_CLASS_OPTIONS}
          value={assetClass}
        />
        <VibeButton
          disabled={saving.blocked || !dirty}
          type="submit"
          variant="outline"
        >
          {saving.pending ? "正在保存…" : saving.refreshing ? "正在更新…" : "保存类别"}
        </VibeButton>
      </div>
      <div role="status">{saved ? <VibeNotice tone="success">{saving.refreshing ? "类别已保存，正在更新页面…" : "类别已保存。"}</VibeNotice> : null}</div>
      <AssetSourceCommandFeedback failure={saving.failure} onContinue={saving.continueAfterCheck} />
    </form>
  );
}
