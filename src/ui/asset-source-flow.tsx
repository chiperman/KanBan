"use client";

import { useEffect, useState } from "react";

import type { AssetMoney, AssetPermission } from "@/server/ports";

interface Preview {
  id: string;
  provider: "longbridge" | "binance";
  account: { id: string; label: string };
  permissions: AssetPermission[];
  total: AssetMoney;
}

function formatAmount(amount: string): string {
  const [integer, fraction] = amount.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

export function AssetSourceFlow() {
  const [choosing, setChoosing] = useState(false);
  const [provider, setProvider] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [binanceApiKey, setBinanceApiKey] = useState("");
  const [binanceApiSecret, setBinanceApiSecret] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const callbackError = params.get("longbridge_error");
    const previewId = params.get("longbridge_preview");
    if (callbackError) {
      setError(callbackError);
      setChoosing(true);
      return;
    }
    if (!previewId) return;
    void fetch(
      `/api/asset-sources/longbridge/preview?id=${encodeURIComponent(previewId)}`,
    )
      .then(async (response) => {
        const body = (await response.json()) as Preview & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "授权预览失败");
        setPreview({ ...body, provider: "longbridge" });
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "授权预览失败");
        setChoosing(true);
      });
  }, []);

  function clearCallbackQuery() {
    window.history.replaceState(null, "", window.location.pathname);
  }

  async function start() {
    if (provider === "binance") {
      setPending(true);
      setError("");
      const response = await fetch("/api/asset-sources/binance/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: binanceApiKey,
          apiSecret: binanceApiSecret,
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | (Preview & { error?: string })
        | null;
      setPending(false);
      if (!response.ok || !body) {
        setError(body?.error ?? "Binance 凭证验证失败");
        return;
      }
      setBinanceApiKey("");
      setBinanceApiSecret("");
      setChoosing(false);
      setPreview({ ...body, provider: "binance" });
      return;
    }
    if (provider !== "longbridge") return;
    setPending(true);
    setError("");
    const response = await fetch(
      "/api/asset-sources/longbridge/oauth/start",
      { method: "POST" },
    );
    const body = (await response.json()) as {
      authorizationUrl?: string;
      error?: string;
    };
    if (!response.ok || !body.authorizationUrl) {
      setPending(false);
      setError(body.error ?? "无法开始长桥授权");
      return;
    }
    window.location.assign(body.authorizationUrl);
  }

  async function confirm() {
    if (!preview) return;
    setPending(true);
    const response = await fetch(
      `/api/asset-sources/${preview.provider}/confirm`,
      {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: preview.id }),
      },
    );
    const body = (await response.json()) as { error?: string };
    if (!response.ok) {
      setPending(false);
      setError(body.error ?? `保存 ${preview.provider === "binance" ? "Binance" : "长桥"} 来源失败`);
      return;
    }
    clearCallbackQuery();
    window.location.reload();
  }

  async function cancelPreview() {
    if (preview) {
      await fetch(
        `/api/asset-sources/${preview.provider}/preview?id=${encodeURIComponent(preview.id)}`,
        { method: "DELETE" },
      );
    }
    setPreview(null);
    setChoosing(false);
    clearCallbackQuery();
  }

  return (
    <>
      <button type="button" onClick={() => { setError(""); setChoosing(true); }}>
        添加资产来源
      </button>
      {error && !choosing && !preview ? <p className="content-error" role="alert">{error}</p> : null}
      {choosing ? (
        <div className="editor-overlay" role="dialog" aria-modal="true" aria-label="添加资产来源">
          <div className="editor-dialog">
            <p className="card-label">添加资产来源</p>
            <p className="login-copy">选择只读来源。连接成功前不会保存凭证或来源。</p>
            {error ? <p className="login-error" role="alert">{error}</p> : null}
            <label className="source-option">
              <input
                type="radio"
                name="asset-provider"
                value="longbridge"
                checked={provider === "longbridge"}
                onChange={(event) => setProvider(event.target.value)}
              />
              长桥 Longbridge
            </label>
            <label className="source-option">
              <input
                type="radio"
                name="asset-provider"
                value="binance"
                checked={provider === "binance"}
                onChange={(event) => setProvider(event.target.value)}
              />
              Binance
            </label>
            {provider === "binance" ? (
              <div className="source-credential-fields">
                <label className="field-label">
                  Binance API Key
                  <input
                    value={binanceApiKey}
                    autoComplete="off"
                    onChange={(event) => setBinanceApiKey(event.target.value)}
                  />
                </label>
                <label className="field-label">
                  Binance API Secret
                  <input
                    type="password"
                    value={binanceApiSecret}
                    autoComplete="new-password"
                    onChange={(event) => setBinanceApiSecret(event.target.value)}
                  />
                </label>
              </div>
            ) : null}
            <div className="editor-actions">
              <button
                type="button"
                className="login-primary"
                disabled={
                  pending ||
                  provider === "" ||
                  (provider === "binance" &&
                    (!binanceApiKey.trim() || !binanceApiSecret.trim()))
                }
                onClick={() => void start()}
              >
                {provider === "binance" ? "验证只读凭证" : "开始 OAuth 授权"}
              </button>
              <button type="button" className="login-cancel" disabled={pending} onClick={() => { setChoosing(false); clearCallbackQuery(); }}>
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {preview ? (
        <div
          className="editor-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={
            preview.provider === "binance"
              ? "确认 Binance 资产来源"
              : "确认长桥资产来源"
          }
        >
          <div className="editor-dialog">
            <p className="card-label">{preview.provider === "binance" ? "Binance 凭证预览" : "长桥授权预览"}</p>
            <h2 className="source-preview-title">{preview.account.label}</h2>
            <dl className="source-preview-list">
              <div>
                <dt>可读取范围</dt>
                <dd>{preview.provider === "binance" ? "现货、资金、Simple Earn（只读）" : "行情、账户、持仓（只读）"}</dd>
              </div>
              <div><dt>账户总额</dt><dd>{formatAmount(preview.total.amount)} {preview.total.currency}</dd></div>
            </dl>
            <p className="login-copy">确认后才会把{preview.provider === "binance" ? "只读 API 凭证" : " OAuth 凭证"}写入服务端安全存储。</p>
            {error ? <p className="login-error" role="alert">{error}</p> : null}
            <div className="editor-actions">
              <button type="button" className="login-primary" disabled={pending} onClick={() => void confirm()}>确认并保存</button>
              <button type="button" className="login-cancel" disabled={pending} onClick={() => void cancelPreview()}>取消</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
