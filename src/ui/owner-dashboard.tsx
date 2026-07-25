"use client";

import { useState, type FormEvent } from "react";

import type { Card, LinkItem } from "@/server/ports";
import { CardContent } from "@/ui/card-content";

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

export function OwnerDashboard({ cards }: { cards: Card[] }) {
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [error, setError] = useState("");

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

  const existingKinds = new Set(cards.map((card) => card.kind));
  return (
    <>
      <div className="owner-toolbar" aria-label="内容管理">
        {!existingKinds.has("identity") ? <button type="button" onClick={() => setEditor({ mode: "create", kind: "identity" })}>新建身份卡片</button> : null}
        {!existingKinds.has("now") ? <button type="button" onClick={() => setEditor({ mode: "create", kind: "now" })}>新建 Now 卡片</button> : null}
        {!existingKinds.has("links") ? <button type="button" onClick={() => setEditor({ mode: "create", kind: "links" })}>新建链接卡片</button> : null}
        <button type="button" onClick={() => setEditor({ mode: "create", kind: "markdown" })}>新建 Markdown 卡片</button>
      </div>
      {error ? <p className="content-error" role="alert">{error}</p> : null}
      <section className="card-grid" data-testid="card-grid">
        {cards.length === 0 ? (
          <div className="empty-state" data-testid="empty-state">
            <p className="empty-title">暂无卡片</p>
            <p className="empty-hint">使用上方内容管理入口创建公开主页内容。</p>
          </div>
        ) : (
          cards.map((card) => (
            <article key={card.id} className={`card span-${card.span}`} data-testid="card">
              <CardContent card={card} />
              {card.kind === "asset" ? (
                <p className="access-status">私密 · 资产卡片不可发布</p>
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
          ))
        )}
      </section>
      {editor ? <CardEditor key={editor.mode === "edit" ? editor.card.id : editor.kind} target={editor} onClose={() => setEditor(null)} /> : null}
    </>
  );
}
