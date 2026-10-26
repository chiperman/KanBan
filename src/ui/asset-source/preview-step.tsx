import { AssetFinancialValue } from "@/ui/asset-financial-value";

import {
  assetSourceProvider,
  type AssetSourceProviderDescription,
  type AssetSourceProviderId,
} from "@/domain/asset-source-providers";
import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";

import {
  formatAmount,
  isEvmProvider,
  type Preview,
  type ProviderSelectionId,
  type Reauthorization,
} from "./shared";

export function SourcePreviewStep({
  providerId,
  savedProviders,
  manualLabel,
  previews,
  descriptionFor,
  recovery,
  uncertainId,
  pending,
  cancelPreview,
  operation,
  reauthorization,
  confirm,
  isReauthorizing,
}: {
  providerId: ProviderSelectionId | "";
  savedProviders: AssetSourceProviderId[];
  manualLabel: string;
  previews: Preview[];
  descriptionFor(id: AssetSourceProviderId): AssetSourceProviderDescription;
  recovery: "revalidate" | "check" | null;
  uncertainId: string | null;
  pending: boolean;
  cancelPreview(revalidate?: boolean): Promise<void>;
  operation: "verify" | "save" | "cancel" | null;
  reauthorization?: Reauthorization;
  confirm(): Promise<void>;
  isReauthorizing: boolean;
}) {
  return (
    <section aria-labelledby="source-flow-preview-title" className="asset-source-flow__panel">
      <h2 id="source-flow-preview-title">
        {providerId === "manual" ? "确认手工来源" : "确认资产来源"}
      </h2>
      <div role="status">
        {savedProviders.length > 0 ? (
          <p>
            已保存：{savedProviders.map((id) => assetSourceProvider(id).label).join("、")}
            。已保存来源会保留。
          </p>
        ) : null}
      </div>
      {providerId === "manual" ? (
        <>
          <dl className="source-preview-list vibe-preview-list">
            <div className="vibe-data-row">
              <dt>资产名称</dt>
              <dd>{manualLabel}</dd>
            </div>
            <div className="vibe-data-row">
              <dt>记录方式</dt>
              <dd>仅记录总额</dd>
            </div>
          </dl>
        </>
      ) : (
        <>
          <dl className="source-preview-list vibe-preview-list">
            {previews.map((current) => {
              const description = descriptionFor(current.provider);
              return (
                <div className="vibe-data-row" key={current.id}>
                  <dt>{description.label}</dt>
                  <dd>
                    <div>{current.account.label}</div>
                    {isEvmProvider(current.provider) ? (
                      <div>来源标识：{current.account.id}</div>
                    ) : null}
                    {recovery === "check" &&
                    (uncertainId === null
                      ? current.id === previews[0]?.id
                      : uncertainId === current.id) ? (
                      <div>保存结果待核对</div>
                    ) : savedProviders.length > 0 ? (
                      <div>待完成</div>
                    ) : null}
                    {description.previewScope(current.accountMode)}，{" "}
                    <AssetFinancialValue unit={current.total.currency}>
                      {formatAmount(current.total.amount, current.provider !== "longbridge")}
                    </AssetFinancialValue>
                  </dd>
                </div>
              );
            })}
          </dl>
        </>
      )}
      <div className="asset-source-flow__actions">
        <VibeButton
          disabled={pending || recovery === "check"}
          onClick={() => void cancelPreview()}
          type="button"
          variant="text"
        >
          {operation === "cancel"
            ? "正在取消…"
            : savedProviders.length > 0
              ? "取消剩余预览"
              : "取消"}
        </VibeButton>
        {recovery === "check" ? (
          <VibeLink
            href={
              reauthorization === undefined
                ? "/settings?view=data#asset-sources"
                : `/asset-sources/${encodeURIComponent(reauthorization.sourceId)}?view=manage`
            }
            variant="primary"
          >
            核对来源
          </VibeLink>
        ) : recovery === "revalidate" ? (
          <VibeButton
            disabled={pending}
            onClick={() => void cancelPreview(true)}
            type="button"
            variant="primary"
          >
            重新验证
          </VibeButton>
        ) : (
          <VibeButton
            aria-busy={operation === "save"}
            disabled={pending || (providerId !== "manual" && previews.length === 0)}
            onClick={() => void confirm()}
            type="button"
            variant="primary"
          >
            {operation === "save"
              ? "正在保存…"
              : providerId === "manual"
                ? "确认创建来源"
                : isReauthorizing
                  ? "确认更新授权"
                  : savedProviders.length > 0
                    ? "重试剩余来源"
                    : "确认并保存"}
          </VibeButton>
        )}
      </div>
    </section>
  );
}
