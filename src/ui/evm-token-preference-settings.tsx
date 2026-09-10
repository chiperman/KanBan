"use client";

import { useState } from "react";

import {
  ignoredAssetKeySet,
  includedAssetKeySet,
  isEvmManagedHolding,
  unrecognizedEvmTokenCandidates,
} from "@/domain/evm-token-preferences";
import type {
  AssetHolding,
  AssetSnapshot,
  EvmUnrecognizedToken,
} from "@/server/ports";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeDialog } from "@/ui/vibe/vibe-dialog";
import { VibeNotice } from "@/ui/vibe/vibe-notice";

export interface EvmTokenPreferenceSettingsSource {
  id: string;
  kind: string;
  name: string;
  snapshot: AssetSnapshot;
  ignoredAssetKeys?: string[];
  includedAssetKeys?: string[];
}

type PreferenceStatus = "included" | "ignored" | "unrecognized";

interface PreferenceAsset {
  sourceAsset: string;
  symbol: string | null;
  name: string | null;
  quantity: string | null;
  native: boolean;
}

interface TokenGroup {
  source: EvmTokenPreferenceSettingsSource;
  tokens: PreferenceAsset[];
}

function sourceCode(source: EvmTokenPreferenceSettingsSource): string {
  return source.kind === "evm-watch-bsc" ? "BSC" : "ETH";
}

function preferenceAssetFromHolding(holding: AssetHolding): PreferenceAsset | null {
  if (!holding.sourceAsset) return null;
  return {
    sourceAsset: holding.sourceAsset,
    symbol: holding.symbol,
    name: holding.name,
    quantity: holding.quantity,
    native: holding.sourceAsset.endsWith(":native"),
  };
}

function preferenceAssetFromCandidate(token: EvmUnrecognizedToken): PreferenceAsset {
  return {
    sourceAsset: token.sourceAsset,
    symbol: token.symbol,
    name: token.name,
    quantity: token.quantity,
    native: false,
  };
}

function recognizedEvmAssets(
  source: EvmTokenPreferenceSettingsSource,
): PreferenceAsset[] {
  return source.snapshot.holdings.flatMap((holding) =>
    isEvmManagedHolding(source.kind, holding) &&
    holding.valuation.status !== "unvalued"
      ? [preferenceAssetFromHolding(holding)].filter(
        (asset): asset is PreferenceAsset => asset !== null,
      )
      : [],
  );
}

function ignoredEvmAssets(
  source: EvmTokenPreferenceSettingsSource,
): PreferenceAsset[] {
  const ignored = ignoredAssetKeySet(source);
  const assets = new Map<string, PreferenceAsset>();
  for (const holding of source.snapshot.holdings) {
    if (!isEvmManagedHolding(source.kind, holding) || !holding.sourceAsset) {
      continue;
    }
    if (ignored.has(holding.sourceAsset)) {
      const asset = preferenceAssetFromHolding(holding);
      if (asset) assets.set(asset.sourceAsset, asset);
    }
  }
  for (const token of unrecognizedEvmTokenCandidates(source)) {
    if (ignored.has(token.sourceAsset) && !assets.has(token.sourceAsset)) {
      const asset = preferenceAssetFromCandidate(token);
      assets.set(asset.sourceAsset, asset);
    }
  }
  return [...assets.values()].toSorted((left, right) =>
    left.sourceAsset.localeCompare(right.sourceAsset),
  );
}

function tokenGroups(
  sources: EvmTokenPreferenceSettingsSource[],
  select: (source: EvmTokenPreferenceSettingsSource) => PreferenceAsset[],
): TokenGroup[] {
  return sources.flatMap((source) => {
    const tokens = select(source);
    return tokens.length > 0 ? [{ source, tokens }] : [];
  });
}

export function EvmTokenPreferenceSettings({
  sources,
}: {
  sources: EvmTokenPreferenceSettingsSource[];
}) {
  const [pendingAssetKey, setPendingAssetKey] = useState<string | null>(null);
  const [nativeAssetToIgnore, setNativeAssetToIgnore] = useState<{
    source: EvmTokenPreferenceSettingsSource;
    asset: PreferenceAsset;
  } | null>(null);
  const [error, setError] = useState("");
  const recognizedGroups = tokenGroups(sources, (source) =>
    recognizedEvmAssets(source).filter(
      ({ sourceAsset }) => !ignoredAssetKeySet(source).has(sourceAsset),
    ),
  );
  const pendingGroups = tokenGroups(sources, (source) =>
    unrecognizedEvmTokenCandidates(source).filter(
      ({ sourceAsset }) =>
        !ignoredAssetKeySet(source).has(sourceAsset) &&
        !includedAssetKeySet(source).has(sourceAsset),
    ).map(preferenceAssetFromCandidate),
  );
  const ignoredGroups = tokenGroups(sources, (source) =>
    ignoredEvmAssets(source),
  );
  const includedGroups = tokenGroups(sources, (source) =>
    unrecognizedEvmTokenCandidates(source).filter(({ sourceAsset }) =>
      includedAssetKeySet(source).has(sourceAsset)
    ).map(preferenceAssetFromCandidate),
  );
  const pendingCount = pendingGroups.reduce(
    (count, group) => count + group.tokens.length,
    0,
  );
  const recognizedCount = recognizedGroups.reduce(
    (count, group) => count + group.tokens.length,
    0,
  );
  const ignoredCount = ignoredGroups.reduce(
    (count, group) => count + group.tokens.length,
    0,
  );
  const includedCount = includedGroups.reduce(
    (count, group) => count + group.tokens.length,
    0,
  );

  async function updatePreference(
    sourceId: string,
    token: PreferenceAsset,
    status: PreferenceStatus,
  ) {
    const assetKey = token.sourceAsset;
    if (pendingAssetKey !== null) return;
    setPendingAssetKey(assetKey);
    setError("");
    try {
      const response = await fetch(
        `/api/asset-sources/${encodeURIComponent(sourceId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "evm-token-preference",
            assetKeys: [assetKey],
            status,
          }),
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? "资产范围设置保存失败");
      }
      window.location.reload();
    } catch (caught) {
      setPendingAssetKey(null);
      setError(
        caught instanceof Error ? caught.message : "资产范围设置保存失败",
      );
    }
  }

  function ignoreAsset(
    source: EvmTokenPreferenceSettingsSource,
    asset: PreferenceAsset,
  ) {
    if (asset.native) {
      setNativeAssetToIgnore({ source, asset });
      return;
    }
    void updatePreference(source.id, asset, "ignored");
  }

  return (
    <section
      className="settings-section evm-token-settings"
      aria-labelledby="evm-token-settings-title"
      data-testid="evm-token-preference-settings"
    >
      <div className="evm-token-settings__head">
        <div>
          <h2 id="evm-token-settings-title">资产范围</h2>
        </div>
        <span className="evm-token-settings__scope">WATCH WALLETS</span>
      </div>

      {sources.length === 0 ? (
        <p className="evm-token-settings__empty">
          尚未添加 EVM 观察钱包。
        </p>
      ) : null}

      {recognizedCount > 0 ? (
        <section
          className="evm-token-settings__group"
          aria-labelledby="recognized-evm-assets-title"
          data-testid="recognized-evm-assets"
        >
          <div className="evm-token-settings__group-head">
            <div>
              <h3 id="recognized-evm-assets-title">已识别资产</h3>
            </div>
            <span>{recognizedCount} 项</span>
          </div>
          {recognizedGroups.map(({ source, tokens }) => (
            <div className="evm-token-settings__source" key={source.id}>
              <p>
                <strong>{source.name}</strong>
                <span>{sourceCode(source)}</span>
              </p>
              <ol>
                {tokens.map((token) => {
                  const pending = pendingAssetKey === token.sourceAsset;
                  return (
                    <li data-asset-key={token.sourceAsset} key={token.sourceAsset}>
                      <div>
                        <strong>{token.symbol ?? "未识别代币"}</strong>
                        <span>{token.sourceAsset}</span>
                        <small>{token.native ? "原生币" : token.name ?? "ERC-20"}</small>
                      </div>
                      <VibeButton
                        disabled={pendingAssetKey !== null}
                        onClick={() => ignoreAsset(source, token)}
                        type="button"
                        variant="text"
                      >
                        {pending ? "正在保存…" : "忽略"}
                      </VibeButton>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </section>
      ) : null}

      {pendingCount > 0 ? (
        <section
          className="evm-token-settings__group"
          aria-labelledby="pending-evm-token-settings-title"
        >
          <div className="evm-token-settings__group-head">
            <div>
              <h3 id="pending-evm-token-settings-title">待确认资产</h3>
            </div>
            <span>{pendingCount} 项</span>
          </div>
          {pendingGroups.map(({ source, tokens }) => (
            <div className="evm-token-settings__source" key={source.id}>
              <p>
                <strong>{source.name}</strong>
                <span>{sourceCode(source)}</span>
              </p>
              <ol>
                {tokens.map((token) => {
                  const assetKey = token.sourceAsset;
                  const pending = pendingAssetKey === assetKey;
                  return (
                    <li key={assetKey}>
                      <div>
                        <strong>{token.symbol ?? "未识别代币"}</strong>
                        <span>{assetKey}</span>
                        <small>
                          {token.quantity === null
                            ? "数量无法读取"
                            : `数量：${token.quantity}`}
                        </small>
                      </div>
                      <div className="evm-token-settings__actions">
                        <VibeButton
                          disabled={pendingAssetKey !== null}
                          onClick={() =>
                            void updatePreference(source.id, token, "included")
                          }
                          type="button"
                          variant="outline"
                        >
                          {pending ? "正在保存…" : "需要关注"}
                        </VibeButton>
                        <VibeButton
                          disabled={pendingAssetKey !== null}
                          onClick={() =>
                            void ignoreAsset(source, token)
                          }
                          type="button"
                          variant="text"
                        >
                          忽略
                        </VibeButton>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </section>
      ) : null}

      {ignoredCount > 0 ? (
        <section
          className="evm-token-settings__group"
          aria-labelledby="ignored-evm-token-settings-title"
        >
          <div className="evm-token-settings__group-head">
            <div>
              <h3 id="ignored-evm-token-settings-title">已忽略资产</h3>
            </div>
            <span>{ignoredCount} 项</span>
          </div>
          {ignoredGroups.map(({ source, tokens }) => (
            <div className="evm-token-settings__source" key={source.id}>
              <p>
                <strong>{source.name}</strong>
                <span>{sourceCode(source)}</span>
              </p>
              <ol>
                {tokens.map((token) => {
                  const pending = pendingAssetKey === token.sourceAsset;
                  return (
                    <li data-asset-key={token.sourceAsset} key={token.sourceAsset}>
                      <div>
                        <strong>{token.symbol ?? "未识别代币"}</strong>
                        <span>{token.sourceAsset}</span>
                        {token.quantity === null ? (
                          <small>数量无法读取</small>
                        ) : null}
                      </div>
                      <VibeButton
                        disabled={pendingAssetKey !== null}
                        onClick={() =>
                          void updatePreference(source.id, token, "unrecognized")
                        }
                        type="button"
                        variant="outline"
                      >
                        {pending ? "正在保存…" : "恢复显示"}
                      </VibeButton>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </section>
      ) : null}

      {includedCount > 0 ? (
        <section
          className="evm-token-settings__group"
          aria-labelledby="included-evm-token-settings-title"
        >
          <div className="evm-token-settings__group-head">
            <div>
              <h3 id="included-evm-token-settings-title">已关注资产</h3>
            </div>
            <span>{includedCount} 项</span>
          </div>
          {includedGroups.map(({ source, tokens }) => (
            <div className="evm-token-settings__source" key={source.id}>
              <p>
                <strong>{source.name}</strong>
                <span>{sourceCode(source)}</span>
              </p>
              <ol>
                {tokens.map((token) => {
                  const assetKey = token.sourceAsset;
                  const pending = pendingAssetKey === assetKey;
                  return (
                    <li key={assetKey}>
                      <div>
                        <strong>{token.symbol ?? "未识别代币"}</strong>
                        <span>{assetKey}</span>
                        {token.quantity === null ? (
                          <small>数量无法读取</small>
                        ) : null}
                      </div>
                      <VibeButton
                        disabled={pendingAssetKey !== null}
                        onClick={() =>
                          void updatePreference(source.id, token, "unrecognized")
                        }
                        type="button"
                        variant="outline"
                      >
                        {pending ? "正在保存…" : "取消关注"}
                      </VibeButton>
                      <VibeButton
                        disabled={pendingAssetKey !== null}
                        onClick={() => ignoreAsset(source, token)}
                        type="button"
                        variant="text"
                      >
                        忽略
                      </VibeButton>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </section>
      ) : null}

      {sources.length > 0 &&
      recognizedCount === 0 &&
      pendingCount === 0 &&
      ignoredCount === 0 &&
      includedCount === 0 ? (
        <p className="evm-token-settings__empty">
          当前没有可管理资产。
        </p>
      ) : null}

      {error ? (
        <VibeNotice role="alert" tone="error">
          {error}
        </VibeNotice>
      ) : null}

      {nativeAssetToIgnore ? (
        <VibeDialog
          actions={
            <>
              <VibeButton
                disabled={pendingAssetKey !== null}
                onClick={() => setNativeAssetToIgnore(null)}
                type="button"
                variant="text"
              >
                取消
              </VibeButton>
              <VibeButton
                disabled={pendingAssetKey !== null}
                onClick={() => {
                  const target = nativeAssetToIgnore;
                  setNativeAssetToIgnore(null);
                  void updatePreference(target.source.id, target.asset, "ignored");
                }}
                type="button"
              >
                仍要忽略
              </VibeButton>
            </>
          }
          description="不再计入总资产，不影响链上资产。"
          onClose={() => setNativeAssetToIgnore(null)}
          title={`确认忽略 ${nativeAssetToIgnore.asset.symbol ?? "原生币"}`}
          titleId="ignore-native-asset-dialog-title"
        />
      ) : null}
    </section>
  );
}
