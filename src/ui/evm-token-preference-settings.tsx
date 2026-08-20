"use client";

import { useState } from "react";

import {
  ignoredAssetKeySet,
  includedAssetKeySet,
  unrecognizedEvmTokenCandidates,
} from "@/domain/evm-token-preferences";
import type {
  AssetSnapshot,
  EvmUnrecognizedToken,
} from "@/server/ports";
import { VibeButton } from "@/ui/vibe/vibe-button";
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

interface TokenGroup {
  source: EvmTokenPreferenceSettingsSource;
  tokens: EvmUnrecognizedToken[];
}

function sourceCode(source: EvmTokenPreferenceSettingsSource): string {
  return source.kind === "evm-watch-bsc" ? "BSC" : "ETH";
}

function tokenAssetKey(token: EvmUnrecognizedToken): string {
  return token.sourceAsset;
}

function tokenGroups(
  sources: EvmTokenPreferenceSettingsSource[],
  select: (source: EvmTokenPreferenceSettingsSource) => EvmUnrecognizedToken[],
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
  const [error, setError] = useState("");
  const pendingGroups = tokenGroups(sources, (source) =>
    unrecognizedEvmTokenCandidates(source).filter(
      ({ sourceAsset }) =>
        !ignoredAssetKeySet(source).has(sourceAsset) &&
        !includedAssetKeySet(source).has(sourceAsset),
    )
  );
  const ignoredGroups = tokenGroups(sources, (source) =>
    unrecognizedEvmTokenCandidates(source).filter(({ sourceAsset }) =>
      ignoredAssetKeySet(source).has(sourceAsset)
    )
  );
  const includedGroups = tokenGroups(sources, (source) =>
    unrecognizedEvmTokenCandidates(source).filter(({ sourceAsset }) =>
      includedAssetKeySet(source).has(sourceAsset)
    )
  );
  const pendingCount = pendingGroups.reduce(
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
    token: EvmUnrecognizedToken,
    status: PreferenceStatus,
  ) {
    const assetKey = tokenAssetKey(token);
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

  return (
    <section
      className="settings-section evm-token-settings"
      aria-labelledby="evm-token-settings-title"
      data-testid="evm-token-preference-settings"
    >
      <div className="evm-token-settings__head">
        <div>
          <h2 id="evm-token-settings-title">资产范围</h2>
          <p className="settings-description">
            管理观察钱包中暂时没有可靠数据的代币。这里的选择只影响资产看板的显示和估值范围，不会发起任何链上操作。
          </p>
        </div>
        <span className="evm-token-settings__scope">WATCH WALLETS</span>
      </div>

      {sources.length === 0 ? (
        <p className="evm-token-settings__empty">
          尚未添加 EVM 观察钱包。
        </p>
      ) : null}

      {pendingCount > 0 ? (
        <section
          className="evm-token-settings__group"
          aria-labelledby="pending-evm-token-settings-title"
        >
          <div className="evm-token-settings__group-head">
            <div>
              <h3 id="pending-evm-token-settings-title">待确认资产</h3>
              <p>
                暂时缺少可靠数据不代表是垃圾代币，系统会继续重试。确认需要关注后，它会回到持仓明细并标记为未估值。
              </p>
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
                  const assetKey = tokenAssetKey(token);
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
                            void updatePreference(source.id, token, "ignored")
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
              <h3 id="ignored-evm-token-settings-title">已忽略代币</h3>
              <p>恢复后，代币会重新回到待确认资产；不会触发任何链上操作。</p>
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
                  const assetKey = tokenAssetKey(token);
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
                        {pending ? "正在保存…" : "恢复到待确认"}
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
              <p>取消关注后，资产会重新回到待确认资产；不会触发任何链上操作。</p>
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
                  const assetKey = tokenAssetKey(token);
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
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </section>
      ) : null}

      {sources.length > 0 &&
      pendingCount === 0 &&
      ignoredCount === 0 &&
      includedCount === 0 ? (
        <p className="evm-token-settings__empty">
          当前没有需要确认、已关注或已忽略的代币。
        </p>
      ) : null}

      {error ? (
        <VibeNotice role="alert" tone="error">
          {error}
        </VibeNotice>
      ) : null}
    </section>
  );
}
