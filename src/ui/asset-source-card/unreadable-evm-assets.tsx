"use client";

import type { EvmUnrecognizedToken } from "@/server/ports";
import { VibeLink } from "@/ui/vibe/vibe-button";
import { VibeStatusTag } from "@/ui/vibe/vibe-data-instrument";

export function UnreadableEvmAssets({
  sourceId,
  tokens: unreadableEvmTokens,
  includedAssetKeys,
  assetScopeHref,
}: {
  sourceId: string;
  tokens: readonly EvmUnrecognizedToken[];
  includedAssetKeys: ReadonlySet<string>;
  assetScopeHref?: string;
}) {
  return (
    <>
      {unreadableEvmTokens.length > 0 ? (
        <section
          aria-labelledby={`evm-unreadable-assets-title-${sourceId}`}
          className="evm-unreadable-assets"
          data-testid="evm-unreadable-assets"
        >
          <div className="evm-unreadable-assets__head">
            <div>
              <h3 id={`evm-unreadable-assets-title-${sourceId}`}>
                读取受限资产
              </h3>
            </div>
            {assetScopeHref ? (
              <VibeLink href={assetScopeHref} variant="outline">
                管理资产范围
              </VibeLink>
            ) : null}
          </div>
          <ol>
            {unreadableEvmTokens.map((token) => {
              const isIncluded = includedAssetKeys.has(token.sourceAsset);
              const displayName = token.name ?? token.symbol ?? "未识别代币";
              return (
                <li key={token.sourceAsset}>
                  <div className="evm-unreadable-assets__identity">
                    <strong>{displayName}</strong>
                    {token.symbol && token.name ? (
                      <span>{token.symbol}</span>
                    ) : null}
                    <small>{token.sourceAsset}</small>
                  </div>
                  <div className="evm-unreadable-assets__status">
                    <VibeStatusTag tone={isIncluded ? "error" : "warning"}>
                      {isIncluded ? "已关注，数量无法读取" : "待确认，数量无法读取"}
                    </VibeStatusTag>
                    <p>{token.reason}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
    </>
  );
}
