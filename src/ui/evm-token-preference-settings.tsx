"use client";

import { useState } from "react";

import {
  ignoredSourceHoldings,
  isUnrecognizedEvmTokenHolding,
} from "@/domain/evm-token-preferences";
import type { AssetHolding, AssetSnapshot } from "@/server/ports";
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
  holdings: AssetHolding[];
}

function sourceCode(source: EvmTokenPreferenceSettingsSource): string {
  return source.kind === "evm-watch-bsc" ? "BSC" : "ETH";
}

function tokenAssetKey(holding: AssetHolding): string {
  if (!holding.sourceAsset) throw new Error("观察钱包代币缺少合约标识");
  return holding.sourceAsset;
}

function tokenGroups(
  sources: EvmTokenPreferenceSettingsSource[],
  select: (source: EvmTokenPreferenceSettingsSource) => AssetHolding[],
): TokenGroup[] {
  return sources.flatMap((source) => {
    const holdings = select(source);
    return holdings.length > 0 ? [{ source, holdings }] : [];
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
    source.snapshot.holdings.filter((holding) =>
      isUnrecognizedEvmTokenHolding(source, holding)
    )
  );
  const ignoredGroups = tokenGroups(sources, ignoredSourceHoldings);
  const pendingCount = pendingGroups.reduce(
    (count, group) => count + group.holdings.length,
    0,
  );
  const ignoredCount = ignoredGroups.reduce(
    (count, group) => count + group.holdings.length,
    0,
  );

  async function updatePreference(
    sourceId: string,
    holding: AssetHolding,
    status: PreferenceStatus,
  ) {
    const assetKey = tokenAssetKey(holding);
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
          {pendingGroups.map(({ source, holdings }) => (
            <div className="evm-token-settings__source" key={source.id}>
              <p>
                <strong>{source.name}</strong>
                <span>{sourceCode(source)}</span>
              </p>
              <ol>
                {holdings.map((holding) => {
                  const assetKey = tokenAssetKey(holding);
                  const pending = pendingAssetKey === assetKey;
                  return (
                    <li key={assetKey}>
                      <div>
                        <strong>{holding.symbol}</strong>
                        <span>{assetKey}</span>
                        <small>数量：{holding.quantity}</small>
                      </div>
                      <div className="evm-token-settings__actions">
                        <VibeButton
                          disabled={pendingAssetKey !== null}
                          onClick={() =>
                            void updatePreference(source.id, holding, "included")
                          }
                          type="button"
                          variant="outline"
                        >
                          {pending ? "正在保存…" : "需要关注"}
                        </VibeButton>
                        <VibeButton
                          disabled={pendingAssetKey !== null}
                          onClick={() =>
                            void updatePreference(source.id, holding, "ignored")
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
          {ignoredGroups.map(({ source, holdings }) => (
            <div className="evm-token-settings__source" key={source.id}>
              <p>
                <strong>{source.name}</strong>
                <span>{sourceCode(source)}</span>
              </p>
              <ol>
                {holdings.map((holding) => {
                  const assetKey = tokenAssetKey(holding);
                  const pending = pendingAssetKey === assetKey;
                  return (
                    <li key={assetKey}>
                      <div>
                        <strong>{holding.symbol}</strong>
                        <span>{assetKey}</span>
                      </div>
                      <VibeButton
                        disabled={pendingAssetKey !== null}
                        onClick={() =>
                          void updatePreference(source.id, holding, "unrecognized")
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

      {sources.length > 0 && pendingCount === 0 && ignoredCount === 0 ? (
        <p className="evm-token-settings__empty">
          当前没有需要确认或已忽略的代币。
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
