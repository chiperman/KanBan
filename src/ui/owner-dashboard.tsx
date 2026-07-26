"use client";

import { useState, type DragEvent, type FormEvent } from "react";

import type {
  Card,
  CardSpan,
  DailyAssetSnapshot,
  LinkItem,
} from "@/server/ports";
import { CardContent } from "@/ui/card-content";
import { AssetSourceFlow } from "@/ui/asset-source-flow";
import { AssetRefreshControls } from "@/ui/asset-refresh-controls";
import {
  AssetSourceCard,
  type AssetSourceView,
} from "@/ui/longbridge-asset-card";
import { TotalAssetOverview } from "@/ui/total-asset-overview";

type OrdinaryKind = "identity" | "now" | "links" | "markdown";
type EditorTarget =
  | { mode: "create"; kind: OrdinaryKind }
  | { mode: "edit"; card: Exclude<Card, { kind: "asset" }> };

const CARD_NAMES: Record<OrdinaryKind, string> = {
  identity: "身份卡片",
  now: "Now 卡片",
  links: "链接卡片",
  markdown: "Markdown 卡片",
};

function actionName(action: string, kind: OrdinaryKind): string {
  return kind === "now" || kind === "markdown"
    ? `${action} ${CARD_NAMES[kind]}`
    : `${action}${CARD_NAMES[kind]}`;
}

function cardName(card: Card): string {
  switch (card.kind) {
    case "identity":
      return card.nickname || "身份卡片";
    case "now":
      return "Now 卡片";
    case "links":
      return "链接卡片";
    case "markdown":
    case "asset":
      return card.title;
  }
}

function sourceName(source: AssetSourceView): string {
  if (source.kind === "longbridge") return "长桥资产";
  if (source.kind === "binance") return "Binance 资产";
  if (source.kind === "okx") return "OKX 资产";
  if (source.kind === "bitget") return "Bitget 资产";
  if (source.kind === "evm-watch-ethereum") return "Ethereum 观察钱包";
  if (source.kind === "evm-watch-bsc") return "BNB Smart Chain 观察钱包";
  return source.label;
}

async function cardRequest(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(result?.error ?? "保存失败，请重试");
  }
}

function CardEditor({
  target,
  onClose,
}: {
  target: EditorTarget;
  onClose: () => void;
}) {
  const card = target.mode === "edit" ? target.card : null;
  const kind = target.mode === "edit" ? target.card.kind : target.kind;
  const [links, setLinks] = useState<LinkItem[]>(
    card?.kind === "links" ? card.links : [{ label: "", url: "" }],
  );
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    let body: Record<string, unknown> = { kind };
    if (kind === "identity") {
      body = {
        ...body,
        avatarUrl: data.get("avatarUrl"),
        nickname: data.get("nickname"),
        introduction: data.get("introduction"),
      };
    } else if (kind === "now") {
      body = { ...body, content: data.get("content") };
    } else if (kind === "links") {
      body = { ...body, links };
    } else {
      body = {
        ...body,
        title: data.get("title"),
        markdown: data.get("markdown"),
      };
    }

    try {
      if (target.mode === "create") {
        await cardRequest("/api/cards", "POST", body);
      } else {
        await cardRequest(`/api/cards/${encodeURIComponent(target.card.id)}`, "PATCH", body);
      }
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败，请重试");
      setPending(false);
    }
  }

  const saveName = actionName("保存", kind);
  return (
    <div className="editor-overlay" role="dialog" aria-modal="true">
      <form className="editor-dialog" onSubmit={submit}>
        <p className="card-label">
          {target.mode === "create" ? "新建" : "编辑"} {CARD_NAMES[kind]}
        </p>
        {kind === "identity" ? (
          <>
            <label className="field-label">
              头像 URL
              <input name="avatarUrl" type="url" defaultValue={card?.kind === "identity" ? card.avatarUrl : ""} />
            </label>
            <label className="field-label">
              昵称
              <input name="nickname" required defaultValue={card?.kind === "identity" ? card.nickname : ""} />
            </label>
            <label className="field-label">
              一句话介绍
              <textarea name="introduction" defaultValue={card?.kind === "identity" ? card.introduction : ""} />
            </label>
          </>
        ) : null}
        {kind === "now" ? (
          <label className="field-label">
            Now 内容
            <textarea name="content" defaultValue={card?.kind === "now" ? card.content : ""} />
          </label>
        ) : null}
        {kind === "links" ? (
          <div className="links-editor">
            {links.map((link, index) => (
              <div className="link-fields" key={index}>
                <label className="field-label">
                  链接名称 {index + 1}
                  <input
                    required
                    value={link.label}
                    onChange={(event) =>
                      setLinks((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, label: event.target.value } : item,
                        ),
                      )
                    }
                  />
                </label>
                <label className="field-label">
                  链接地址 {index + 1}
                  <input
                    required
                    type="url"
                    value={link.url}
                    onChange={(event) =>
                      setLinks((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, url: event.target.value } : item,
                        ),
                      )
                    }
                  />
                </label>
                {links.length > 1 ? (
                  <button type="button" className="text-button" onClick={() => setLinks((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                    移除此链接
                  </button>
                ) : null}
              </div>
            ))}
            <button type="button" className="secondary-button" onClick={() => setLinks((current) => [...current, { label: "", url: "" }])}>
              添加链接
            </button>
          </div>
        ) : null}
        {kind === "markdown" ? (
          <>
            <label className="field-label">
              标题
              <input name="title" required defaultValue={card?.kind === "markdown" ? card.title : ""} />
            </label>
            <label className="field-label">
              Markdown 正文
              <textarea name="markdown" rows={8} defaultValue={card?.kind === "markdown" ? card.markdown : ""} />
            </label>
          </>
        ) : null}
        {error ? <p className="login-error" role="alert">{error}</p> : null}
        <div className="editor-actions">
          <button type="submit" className="login-primary" disabled={pending}>{saveName}</button>
          <button type="button" className="login-cancel" disabled={pending} onClick={onClose}>取消</button>
        </div>
      </form>
    </div>
  );
}

export function OwnerDashboard({
  cards,
  assetSources,
  dailyAssetSnapshots,
  currentDay,
}: {
  cards: Card[];
  assetSources: AssetSourceView[];
  dailyAssetSnapshots: DailyAssetSnapshot[];
  currentDay: string;
}) {
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [error, setError] = useState("");
  const [layoutEditing, setLayoutEditing] = useState(false);
  const [layoutCards, setLayoutCards] = useState(cards);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    source: AssetSourceView;
    stage: 1 | 2;
  } | null>(null);
  const [lifecyclePending, setLifecyclePending] = useState(false);

  function enterLayoutEditing() {
    setLayoutCards(cards);
    setError("");
    setLayoutEditing(true);
  }

  function cancelLayoutEditing() {
    setLayoutCards(cards);
    setDraggedId(null);
    setLayoutEditing(false);
  }

  function startDragging(event: DragEvent<HTMLElement>, id: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
    setDraggedId(id);
  }

  function dropBefore(event: DragEvent<HTMLElement>, targetId: string) {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData("text/plain") || draggedId;
    setDraggedId(null);
    if (!sourceId || sourceId === targetId) return;
    setLayoutCards((current) => {
      const source = current.find((card) => card.id === sourceId);
      if (!source) return current;
      const remaining = current.filter((card) => card.id !== sourceId);
      const targetIndex = remaining.findIndex((card) => card.id === targetId);
      if (targetIndex === -1) return current;
      return [
        ...remaining.slice(0, targetIndex),
        source,
        ...remaining.slice(targetIndex),
      ];
    });
  }

  function changeSpan(id: string, span: CardSpan) {
    setLayoutCards((current) =>
      current.map((card) => (card.id === id ? { ...card, span } : card)),
    );
  }

  async function saveLayout() {
    setError("");
    try {
      await cardRequest("/api/cards/layout", "PUT", {
        cards: layoutCards.map(({ id, span }) => ({ id, span })),
      });
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败，请重试");
    }
  }

  async function toggleAccess(card: Exclude<Card, { kind: "asset" }>) {
    setError("");
    try {
      await cardRequest(`/api/cards/${encodeURIComponent(card.id)}`, "PATCH", {
        access: card.access === "public" ? "private" : "public",
      });
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败，请重试");
    }
  }

  async function deleteMarkdown(card: Extract<Card, { kind: "markdown" }>) {
    if (!window.confirm(`确认删除“${card.title}”吗？`)) return;
    setError("");
    try {
      await cardRequest(`/api/cards/${encodeURIComponent(card.id)}`, "DELETE");
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除失败，请重试");
    }
  }

  async function setSourceHidden(source: AssetSourceView, hidden: boolean) {
    setError("");
    try {
      await cardRequest(`/api/asset-sources/${encodeURIComponent(source.id)}`, "PATCH", {
        action: "visibility",
        hidden,
      });
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "来源操作失败");
    }
  }

  async function disconnectSource(source: AssetSourceView) {
    if (!window.confirm(`断开“${sourceName(source)}”将删除只读凭证并停止同步，但保留已有数据和历史快照。确认断开吗？`)) return;
    setError("");
    try {
      await cardRequest(`/api/asset-sources/${encodeURIComponent(source.id)}`, "PATCH", {
        action: "disconnect",
      });
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "断开失败，请重试");
    }
  }

  async function permanentlyDeleteSource() {
    if (!deleteTarget) return;
    setLifecyclePending(true);
    setError("");
    try {
      await cardRequest(
        `/api/asset-sources/${encodeURIComponent(deleteTarget.source.id)}`,
        "DELETE",
        { confirmation: "DELETE_SOURCE_DATA" },
      );
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "永久删除失败，请重试");
      setDeleteTarget(null);
      setLifecyclePending(false);
    }
  }

  const existingKinds = new Set(cards.map((card) => card.kind));
  const visibleCards = (layoutEditing ? layoutCards : cards).filter(
    (card) => card.kind !== "asset" || !card.hidden,
  );
  const hiddenAssetCards = cards.flatMap((card) => {
    if (card.kind !== "asset" || !card.hidden || !card.sourceId) return [];
    const source = assetSources.find((item) => item.id === card.sourceId);
    return source ? [{ card, source }] : [];
  });
  return (
    <>
      <div className="owner-toolbar" aria-label="内容管理">
        {layoutEditing ? (
          <>
            <button type="button" onClick={() => void saveLayout()}>保存布局</button>
            <button type="button" onClick={cancelLayoutEditing}>取消布局编辑</button>
          </>
        ) : (
          <>
            {!existingKinds.has("identity") ? <button type="button" onClick={() => setEditor({ mode: "create", kind: "identity" })}>新建身份卡片</button> : null}
            {!existingKinds.has("now") ? <button type="button" onClick={() => setEditor({ mode: "create", kind: "now" })}>新建 Now 卡片</button> : null}
            {!existingKinds.has("links") ? <button type="button" onClick={() => setEditor({ mode: "create", kind: "links" })}>新建链接卡片</button> : null}
            <button type="button" onClick={() => setEditor({ mode: "create", kind: "markdown" })}>新建 Markdown 卡片</button>
            <AssetSourceFlow />
            <button type="button" onClick={enterLayoutEditing}>编辑布局</button>
          </>
        )}
      </div>
      <AssetRefreshControls
        enabled={assetSources.some((source) => source.lifecycle !== "disconnected")}
      />
      {layoutEditing ? (
        <p className="layout-mode-status" role="status">
          布局编辑模式：拖拽卡片排序，并选择卡片宽度。
        </p>
      ) : null}
      {error ? <p className="content-error" role="alert">{error}</p> : null}
      <section
        className={`card-grid${layoutEditing ? " layout-editing" : ""}`}
        data-testid="card-grid"
      >
        {assetSources.length > 0 ? (
          <article
            className="card span-3 total-overview-card"
            data-testid="total-overview-card"
            data-command-target="total-overview"
            data-command-label="总资产概览"
            tabIndex={-1}
          >
            <TotalAssetOverview
              sources={assetSources}
              history={dailyAssetSnapshots}
              currentDay={currentDay}
            />
          </article>
        ) : null}
        {visibleCards.length === 0 && assetSources.length === 0 ? (
          <div className="empty-state" data-testid="empty-state">
            <p className="empty-title">暂无卡片</p>
            <p className="empty-hint">使用上方内容管理入口创建公开主页内容。</p>
          </div>
        ) : (
          visibleCards.map((card) => {
            const source = card.kind === "asset" && card.sourceId
              ? assetSources.find((item) => item.id === card.sourceId)
              : undefined;
            return (
            <article
              key={card.id}
              className={`card span-${card.span}${draggedId === card.id ? " card-dragging" : ""}`}
              data-testid="card"
              data-command-target={card.id}
              data-command-label={source ? sourceName(source) : cardName(card)}
              tabIndex={-1}
              draggable={layoutEditing}
              onDragStart={layoutEditing ? (event) => startDragging(event, card.id) : undefined}
              onDragEnd={layoutEditing ? () => setDraggedId(null) : undefined}
              onDragOver={layoutEditing ? (event) => event.preventDefault() : undefined}
              onDrop={layoutEditing ? (event) => dropBefore(event, card.id) : undefined}
            >
              {card.kind === "asset" && card.sourceId ? (
                  source ? (
                    <AssetSourceCard
                      source={source}
                      history={dailyAssetSnapshots}
                    />
                  ) : (
                    <CardContent card={card} />
                  )
              ) : (
                <CardContent card={card} />
              )}
              {layoutEditing ? (
                <label className="layout-span-control">
                  {cardName(card)}宽度
                  <select
                    value={card.span}
                    onChange={(event) => {
                      const span = Number(event.target.value);
                      if (span === 1 || span === 2 || span === 3) {
                        changeSpan(card.id, span);
                      }
                    }}
                  >
                    <option value="1">一格</option>
                    <option value="2">两格</option>
                    <option value="3">三格</option>
                  </select>
                </label>
              ) : card.kind === "asset" ? (
                <div className="card-actions">
                  <span className="access-status">私密 · 资产卡片不可发布</span>
                  {source ? (
                    <>
                      <button type="button" className="text-button" onClick={() => void setSourceHidden(source, true)}>
                        隐藏 {sourceName(source)}
                      </button>
                      {source.lifecycle !== "disconnected" ? (
                        <button type="button" className="text-button" onClick={() => void disconnectSource(source)}>
                          断开 {sourceName(source)}
                        </button>
                      ) : null}
                      <button type="button" className="text-button danger-button" onClick={() => setDeleteTarget({ source, stage: 1 })}>
                        永久删除 {sourceName(source)}数据
                      </button>
                    </>
                  ) : null}
                </div>
              ) : (
                <div className="card-actions">
                  <span className="access-status">{card.access === "public" ? "公开" : "私密"}</span>
                  <button type="button" className="text-button" onClick={() => setEditor({ mode: "edit", card })}>
                    {actionName("编辑", card.kind)}
                  </button>
                  <button type="button" className="text-button" onClick={() => void toggleAccess(card)}>
                    {card.access === "public"
                      ? actionName("转为私密", card.kind)
                      : actionName("发布", card.kind)}
                  </button>
                  {card.kind === "markdown" ? (
                    <button type="button" className="text-button danger-button" onClick={() => void deleteMarkdown(card)}>删除 Markdown 卡片</button>
                  ) : null}
                </div>
              )}
            </article>
            );
          })
        )}
      </section>
      {hiddenAssetCards.length > 0 ? (
        <section className="hidden-source-management" aria-labelledby="hidden-source-title">
          <h2 id="hidden-source-title">已隐藏的资产来源</h2>
          {hiddenAssetCards.map(({ card, source }) => (
            <div className="card-actions" key={card.id}>
              <span>{sourceName(source)} · 仍在同步并计入总资产</span>
              <button type="button" className="text-button" onClick={() => void setSourceHidden(source, false)}>
                重新显示 {sourceName(source)}
              </button>
              {source.lifecycle !== "disconnected" ? (
                <button type="button" className="text-button" onClick={() => void disconnectSource(source)}>
                  断开 {sourceName(source)}
                </button>
              ) : null}
              <button type="button" className="text-button danger-button" onClick={() => setDeleteTarget({ source, stage: 1 })}>
                永久删除 {sourceName(source)}数据
              </button>
            </div>
          ))}
        </section>
      ) : null}
      {editor ? <CardEditor key={editor.mode === "edit" ? editor.card.id : editor.kind} target={editor} onClose={() => setEditor(null)} /> : null}
      {deleteTarget ? (
        <div className="editor-overlay" role="dialog" aria-modal="true" aria-label={deleteTarget.stage === 1 ? "永久删除来源数据" : "第二次确认永久删除"}>
          <div className="editor-dialog">
            <p className="card-label">{deleteTarget.stage === 1 ? "永久删除来源数据" : "第二次确认"}</p>
            <h2>{sourceName(deleteTarget.source)}</h2>
            <p>
              {deleteTarget.stage === 1
                ? "这会永久删除该来源、持仓记录、同步记录和全部资产快照，且无法恢复。"
                : "最后确认：删除后无法找回任何该来源历史。"}
            </p>
            <div className="editor-actions">
              {deleteTarget.stage === 1 ? (
                <button type="button" className="danger-button" onClick={() => setDeleteTarget({ ...deleteTarget, stage: 2 })}>
                  继续删除
                </button>
              ) : (
                <button type="button" className="danger-button" disabled={lifecyclePending} onClick={() => void permanentlyDeleteSource()}>
                  确认永久删除
                </button>
              )}
              <button type="button" className="login-cancel" disabled={lifecyclePending} onClick={() => setDeleteTarget(null)}>
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
