import type { Card, CardSpan } from "@/server/ports";

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null;
}

function isSpan(value: unknown): value is CardSpan {
  return value === 1 || value === 2 || value === 3;
}

function parseAssetCard(value: unknown): Card | null {
  if (!isRecord(value) || value.kind !== "asset") return null;
  if (
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.body !== "string" ||
    !isSpan(value.span) ||
    (value.sourceId !== undefined && typeof value.sourceId !== "string") ||
    (value.hidden !== undefined && typeof value.hidden !== "boolean") ||
    (value.startsNewRow !== undefined && typeof value.startsNewRow !== "boolean")
  ) {
    throw new Error("资产卡片数据格式无效");
  }

  return {
    id: value.id,
    kind: "asset",
    title: value.title,
    body: value.body,
    span: value.span,
    ...(value.sourceId === undefined ? {} : { sourceId: value.sourceId }),
    ...(value.hidden === undefined ? {} : { hidden: value.hidden }),
    ...(value.startsNewRow === undefined
      ? {}
      : { startsNewRow: value.startsNewRow }),
  };
}

function parseLegacyRestrictedCard(value: unknown): Card | null {
  if (!isRecord(value) || value.kind !== undefined) return null;
  if (value.access !== "restricted") return null;
  if (
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.body !== "string" ||
    !isSpan(value.span)
  ) {
    throw new Error("旧资产卡片数据格式无效");
  }
  return {
    id: value.id,
    kind: "asset",
    title: value.title,
    body: value.body,
    span: value.span,
  };
}

/**
 * 只保留资产卡片。旧版身份、Now、链接、Markdown 与公开内容在迁移时直接丢弃，
 * 不再进入运行时领域模型。
 */
export function parseAssetCards(value: unknown): Card[] | null {
  if (!Array.isArray(value)) return null;
  const cards: Card[] = [];
  try {
    for (const item of value) {
      const card = parseAssetCard(item) ?? parseLegacyRestrictedCard(item);
      if (card) cards.push(card);
    }
  } catch {
    return null;
  }
  return cards;
}

export function updateAssetCardLayout(cards: Card[], value: unknown): Card[] {
  if (!isRecord(value) || !Array.isArray(value.cards)) {
    throw new Error("布局数据格式无效");
  }

  const layout = value.cards;
  if (layout.length !== cards.length) {
    throw new Error("布局必须包含全部资产卡片");
  }

  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const seen = new Set<string>();
  return layout.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      !isSpan(item.span) ||
      (item.startsNewRow !== undefined &&
        typeof item.startsNewRow !== "boolean") ||
      seen.has(item.id)
    ) {
      throw new Error("布局卡片或宽度无效");
    }
    const card = cardsById.get(item.id);
    if (card === undefined) {
      throw new Error("布局包含未知资产卡片");
    }
    seen.add(item.id);
    return {
      ...card,
      span: item.span,
      startsNewRow: item.startsNewRow === true || undefined,
    };
  });
}
