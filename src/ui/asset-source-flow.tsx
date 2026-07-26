"use client";

import { useEffect, useState } from "react";

import type {
  AssetMoney,
  AssetPermission,
  BitgetAccountMode,
  OkxRegion,
} from "@/server/ports";

interface Preview {
  id: string;
  provider: "longbridge" | "binance" | "okx" | "bitget" | "ethereum" | "bsc";
  account: { id: string; label: string };
  permissions: AssetPermission[];
  total: AssetMoney;
  accountMode?: BitgetAccountMode;
}

type Provider = Preview["provider"] | "";

function providerLabel(provider: Preview["provider"]): string {
  if (provider === "binance") return "Binance";
  if (provider === "okx") return "OKX";
  if (provider === "bitget") return "Bitget";
  if (provider === "ethereum") return "Ethereum 观察钱包";
  if (provider === "bsc") return "BNB Smart Chain 观察钱包";
  return "长桥";
}

function previewScope(
  provider: Preview["provider"],
  accountMode?: BitgetAccountMode,
): string {
  if (provider === "binance") return "现货、资金、Simple Earn（只读）";
  if (provider === "okx") return "现货、资金、Simple Earn Flexible（只读）";
  if (provider === "bitget") {
    return `${accountMode === "uta" ? "UTA 纯现金" : "Classic Account"} · 现货、资金、Earn（只读）`;
  }
  if (provider === "ethereum") return "ETH、ERC-20（公开地址只读）";
  if (provider === "bsc") return "BNB、BEP-20（公开地址只读）";
  return "账户、持仓（只读）";
}

function formatAmount(amount: string): string {
  const [integer, fraction] = amount.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

export function AssetSourceFlow() {
  const [choosing, setChoosing] = useState(false);
  const [provider, setProvider] = useState<Provider>("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [okxRegion, setOkxRegion] = useState<OkxRegion>("global");
  const [bitgetAccountMode, setBitgetAccountMode] =
    useState<BitgetAccountMode>("classic");
  const [evmAddresses, setEvmAddresses] = useState("");

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
    if (provider === "ethereum" || provider === "bsc") {
      setPending(true);
      setError("");
      const response = await fetch("/api/asset-sources/evm/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chain: provider,
          addresses: evmAddresses.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | (Preview & { error?: string })
        | null;
      setPending(false);
      if (!response.ok || !body) {
        setError(body?.error ?? "Ethereum 公开地址验证失败");
        return;
      }
      setEvmAddresses("");
      setChoosing(false);
      setPreview({ ...body, provider });
      return;
    }
    if (
      provider === "binance" ||
      provider === "okx" ||
      provider === "bitget"
    ) {
      setPending(true);
      setError("");
      const response = await fetch(`/api/asset-sources/${provider}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          apiSecret,
          ...(provider === "okx" ? { passphrase, region: okxRegion } : {}),
          ...(provider === "bitget"
            ? { passphrase, accountMode: bitgetAccountMode }
            : {}),
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | (Preview & { error?: string })
        | null;
      setPending(false);
      if (!response.ok || !body) {
        setError(body?.error ?? `${providerLabel(provider)} 凭证验证失败`);
        return;
      }
      setApiKey("");
      setApiSecret("");
      setPassphrase("");
      setChoosing(false);
      setPreview({ ...body, provider });
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
      `/api/asset-sources/${preview.provider === "ethereum" || preview.provider === "bsc" ? "evm" : preview.provider}/confirm`,
      {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: preview.id }),
      },
    );
    const body = (await response.json()) as { error?: string };
    if (!response.ok) {
      setPending(false);
      setError(body.error ?? `保存 ${providerLabel(preview.provider)} 来源失败`);
      return;
    }
    clearCallbackQuery();
    window.location.reload();
  }

  async function cancelPreview() {
    if (preview) {
      await fetch(
        `/api/asset-sources/${preview.provider === "ethereum" || preview.provider === "bsc" ? "evm" : preview.provider}/preview?id=${encodeURIComponent(preview.id)}`,
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
                onChange={(event) => setProvider(event.target.value as Provider)}
              />
              长桥 Longbridge
            </label>
            <label className="source-option">
              <input
                type="radio"
                name="asset-provider"
                value="binance"
                checked={provider === "binance"}
                onChange={(event) => setProvider(event.target.value as Provider)}
              />
              Binance
            </label>
            <label className="source-option">
              <input
                type="radio"
                name="asset-provider"
                value="okx"
                checked={provider === "okx"}
                onChange={(event) => setProvider(event.target.value as Provider)}
              />
              OKX
            </label>
            <label className="source-option">
              <input
                type="radio"
                name="asset-provider"
                value="bitget"
                checked={provider === "bitget"}
                onChange={(event) => setProvider(event.target.value as Provider)}
              />
              Bitget
            </label>
            <label className="source-option">
              <input
                type="radio"
                name="asset-provider"
                value="ethereum"
                checked={provider === "ethereum"}
                onChange={(event) => setProvider(event.target.value as Provider)}
              />
              Ethereum 观察钱包
            </label>
            <label className="source-option">
              <input
                type="radio"
                name="asset-provider"
                value="bsc"
                checked={provider === "bsc"}
                onChange={(event) => setProvider(event.target.value as Provider)}
              />
              BNB Smart Chain 观察钱包
            </label>
            {provider === "binance" || provider === "okx" || provider === "bitget" ? (
              <div className="source-credential-fields">
                {provider === "bitget" ? (
                  <label className="field-label">
                    Bitget 账户类型
                    <select
                      value={bitgetAccountMode}
                      onChange={(event) =>
                        setBitgetAccountMode(
                          event.target.value as BitgetAccountMode,
                        )}
                    >
                      <option value="classic">Classic Account</option>
                      <option value="uta">Unified Trading Account (UTA)</option>
                    </select>
                  </label>
                ) : null}
                {provider === "okx" ? (
                  <label className="field-label">
                    OKX 注册区域
                    <select
                      value={okxRegion}
                      onChange={(event) =>
                        setOkxRegion(event.target.value as OkxRegion)}
                    >
                      <option value="global">Global</option>
                      <option value="us">US / AU</option>
                      <option value="eea">EEA</option>
                    </select>
                  </label>
                ) : null}
                <label className="field-label">
                  {providerLabel(provider)} API Key
                  <input
                    value={apiKey}
                    autoComplete="off"
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                </label>
                <label className="field-label">
                  {providerLabel(provider)} API Secret
                  <input
                    type="password"
                    value={apiSecret}
                    autoComplete="new-password"
                    onChange={(event) => setApiSecret(event.target.value)}
                  />
                </label>
                {provider === "okx" || provider === "bitget" ? (
                  <label className="field-label">
                    {providerLabel(provider)} Passphrase
                    <input
                      type="password"
                      value={passphrase}
                      autoComplete="new-password"
                      onChange={(event) => setPassphrase(event.target.value)}
                    />
                  </label>
                ) : null}
              </div>
            ) : null}
            {provider === "ethereum" || provider === "bsc" ? (
              <div className="source-credential-fields">
                <label className="field-label">
                  {provider === "ethereum" ? "Ethereum" : "BNB Smart Chain"} 公开地址（每行一个）
                  <textarea
                    rows={4}
                    value={evmAddresses}
                    autoComplete="off"
                    onChange={(event) => setEvmAddresses(event.target.value)}
                  />
                </label>
                <p className="login-copy">仅查询公开地址余额。</p>
              </div>
            ) : null}
            <div className="editor-actions">
              <button
                type="button"
                className="login-primary"
                disabled={
                  pending ||
                  provider === "" ||
                  ((provider === "ethereum" || provider === "bsc") && !evmAddresses.trim()) ||
                  ((provider === "binance" || provider === "okx" || provider === "bitget") &&
                    (!apiKey.trim() ||
                      !apiSecret.trim() ||
                      ((provider === "okx" || provider === "bitget") && !passphrase.trim())))
                }
                onClick={() => void start()}
              >
                {provider === "ethereum" || provider === "bsc"
                  ? "验证公开地址"
                  : provider === "binance" || provider === "okx" || provider === "bitget"
                  ? "验证只读凭证"
                  : "开始 OAuth 授权"}
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
            preview.provider === "longbridge"
              ? "确认长桥资产来源"
              : preview.provider === "ethereum" || preview.provider === "bsc"
                ? `确认 ${providerLabel(preview.provider)}`
              : `确认 ${providerLabel(preview.provider)} 资产来源`
          }
        >
          <div className="editor-dialog">
            <p className="card-label">
              {preview.provider === "longbridge"
                ? "长桥授权预览"
                : preview.provider === "ethereum" || preview.provider === "bsc"
                  ? `${providerLabel(preview.provider)}公开地址预览`
                : `${providerLabel(preview.provider)} 凭证预览`}
            </p>
            <h2 className="source-preview-title">{preview.account.label}</h2>
            <dl className="source-preview-list">
              <div>
                <dt>可读取范围</dt>
                <dd>{previewScope(preview.provider, preview.accountMode)}</dd>
              </div>
              <div><dt>账户总额</dt><dd>{formatAmount(preview.total.amount)} {preview.total.currency}</dd></div>
            </dl>
            <p className="login-copy">
              确认后才会把
              {preview.provider === "longbridge"
                ? " OAuth 凭证"
                : preview.provider === "ethereum" || preview.provider === "bsc"
                  ? "公开地址配置"
                  : "只读 API 凭证"}
              写入服务端存储。
            </p>
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
