import { randomUUID } from "node:crypto";

import type {
  Card,
  CardAccess,
  CardSpan,
  IdentityCard,
  LinkItem,
  LinksCard,
  MarkdownCard,
  NowCard,
} from "@/server/ports";

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null;
}

function isSpan(value: unknown): value is CardSpan {
  return value === 1 || value === 2 || value === 3;
}

function isAccess(value: unknown): value is CardAccess {
  return value === "public" || value === "private";
}

function isWebUrl(value: string, allowEmpty = false): boolean {
  if (allowEmpty && value === "") return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isLink(value: unknown): value is LinkItem {
  if (!isRecord(value)) return false;
  return (
    typeof value.label === "string" &&
    value.label.trim().length > 0 &&
    typeof value.url === "string" &&
    isWebUrl(value.url)
  );
}

function isCard(value: unknown): value is Card {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== "string" ||
    !isSpan(value.span) ||
    !isAccess(value.access)
  ) {
    return false;
  }

  switch (value.kind) {
    case "identity":
      return (
        typeof value.avatarUrl === "string" &&
        isWebUrl(value.avatarUrl, true) &&
        typeof value.nickname === "string" &&
        typeof value.introduction === "string"
      );
    case "now":
      return typeof value.content === "string";
    case "links":
      return Array.isArray(value.links) && value.links.every(isLink);
    case "markdown":
      return (
        typeof value.title === "string" &&
        value.title.trim().length > 0 &&
        typeof value.markdown === "string"
      );
    case "asset":
      return (
        value.access === "private" &&
        typeof value.title === "string" &&
        typeof value.body === "string" &&
        (value.sourceId === undefined || typeof value.sourceId === "string") &&
        (value.hidden === undefined || typeof value.hidden === "boolean")
      );
    default:
      return false;
  }
}

interface LegacyCard {
  id: string;
  title: string;
  body: string;
  span: CardSpan;
  access: "public" | "restricted";
}

function isLegacyCard(value: unknown): value is LegacyCard {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.body === "string" &&
    isSpan(value.span) &&
    (value.access === "public" || value.access === "restricted")
  );
}

/**
 * Ticket 02 的通用卡片没有 kind。公开的固定卡片按稳定 id 升级；其余公开
 * 内容成为 Markdown。旧受限卡片只能代表当时的敏感/资产内容，因此保守地
 * 升级为永久私密资产卡片，绝不因迁移获得发布能力。
 */
function migrateLegacyCard(card: LegacyCard): Card {
  if (card.access === "restricted") {
    return {
      id: card.id,
      kind: "asset",
      title: card.title,
      body: card.body,
      span: card.span,
      access: "private",
    };
  }
  if (card.id === "identity") {
    return {
      id: card.id,
      kind: "identity",
      avatarUrl: "",
      nickname: "所有者",
      introduction: card.body,
      span: card.span,
      access: "public",
    };
  }
  if (card.id === "now") {
    return {
      id: card.id,
      kind: "now",
      content: card.body,
      span: card.span,
      access: "public",
    };
  }
  return {
    id: card.id,
    kind: "markdown",
    title: card.title.trim() || "未命名卡片",
    markdown: card.body,
    span: card.span,
    access: "public",
  };
}

export function parseCards(value: unknown): Card[] | null {
  if (!Array.isArray(value)) return null;
  const cards: Card[] = [];
  for (const item of value) {
    if (isCard(item)) {
      cards.push(item);
    } else if (isLegacyCard(item)) {
      cards.push(migrateLegacyCard(item));
    } else {
      return null;
    }
  }
  return cards;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label}不能为空`);
  }
  return value.trim();
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label}格式无效`);
  return value.trim();
}

function avatarUrl(value: unknown): string {
  const url = stringValue(value, "头像 URL");
  if (!isWebUrl(url, true)) throw new Error("头像 URL 必须使用 http 或 https");
  return url;
}

function linksValue(value: unknown): LinkItem[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isLink)) {
    throw new Error("链接必须包含名称和有效的 http 或 https 地址");
  }
  return value.map((link) => ({ label: link.label.trim(), url: link.url }));
}

export function createOrdinaryCard(value: unknown): Card {
  if (!isRecord(value)) throw new Error("卡片数据格式无效");
  const base = {
    id: `${String(value.kind)}-${randomUUID()}`,
    span: 1 as const,
    access: "private" as const,
  };

  switch (value.kind) {
    case "identity":
      return {
        ...base,
        kind: "identity",
        avatarUrl: avatarUrl(value.avatarUrl),
        nickname: requiredString(value.nickname, "昵称"),
        introduction: stringValue(value.introduction, "一句话介绍"),
      };
    case "now":
      return {
        ...base,
        kind: "now",
        content: stringValue(value.content, "Now 内容"),
      };
    case "links":
      return { ...base, kind: "links", links: linksValue(value.links) };
    case "markdown":
      return {
        ...base,
        kind: "markdown",
        title: requiredString(value.title, "标题"),
        markdown: stringValue(value.markdown, "Markdown 正文"),
      };
    default:
      throw new Error("只能创建普通内容卡片");
  }
}

export function updateCard(card: Card, value: unknown): Card {
  if (!isRecord(value)) throw new Error("卡片数据格式无效");
  let access = card.access;
  if (value.access !== undefined) {
    if (!isAccess(value.access)) throw new Error("访问级别无效");
    if (card.kind === "asset" && value.access === "public") {
      throw new Error("资产卡片始终为私密，不能发布");
    }
    access = value.access;
  }

  switch (card.kind) {
    case "identity":
      return {
        ...card,
        access,
        avatarUrl:
          value.avatarUrl === undefined
            ? card.avatarUrl
            : avatarUrl(value.avatarUrl),
        nickname:
          value.nickname === undefined
            ? card.nickname
            : requiredString(value.nickname, "昵称"),
        introduction:
          value.introduction === undefined
            ? card.introduction
            : stringValue(value.introduction, "一句话介绍"),
      } satisfies IdentityCard;
    case "now":
      return {
        ...card,
        access,
        content:
          value.content === undefined
            ? card.content
            : stringValue(value.content, "Now 内容"),
      } satisfies NowCard;
    case "links":
      return {
        ...card,
        access,
        links: value.links === undefined ? card.links : linksValue(value.links),
      } satisfies LinksCard;
    case "markdown":
      return {
        ...card,
        access,
        title:
          value.title === undefined
            ? card.title
            : requiredString(value.title, "标题"),
        markdown:
          value.markdown === undefined
            ? card.markdown
            : stringValue(value.markdown, "Markdown 正文"),
      } satisfies MarkdownCard;
    case "asset":
      return card;
  }
}

export function updateCardLayout(cards: Card[], value: unknown): Card[] {
  if (!isRecord(value) || !Array.isArray(value.cards)) {
    throw new Error("布局数据格式无效");
  }

  const layout = value.cards;
  if (layout.length !== cards.length) {
    throw new Error("布局必须包含全部卡片");
  }

  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const seen = new Set<string>();
  return layout.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      !isSpan(item.span) ||
      seen.has(item.id)
    ) {
      throw new Error("布局卡片或宽度无效");
    }
    const card = cardsById.get(item.id);
    if (card === undefined) {
      throw new Error("布局包含未知卡片");
    }
    seen.add(item.id);
    return { ...card, span: item.span };
  });
}
