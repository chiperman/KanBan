import type { CardSpan } from "@/server/ports";

export type LayoutCard = {
  id: string;
  span: CardSpan;
  startsNewRow?: boolean;
  hidden?: boolean;
};

export type DropCandidate = {
  id: string;
  draggedId: string;
  kind: "reorder" | "fill-gap" | "new-row";
  insertIndex: number;
  row: number;
  columnStart: number;
  span: CardSpan;
  previousSpan: CardSpan;
  startsNewRow: boolean;
};

export type DropPlan = {
  candidates: DropCandidate[];
};

type PackedCard = {
  id: string;
  row: number;
  columnStart: number;
  span: number;
};

function packLayout(cards: LayoutCard[], columns: 1 | 2 | 3): PackedCard[] {
  let row = 0;
  let columnStart = 0;

  return cards.map((card) => {
    const span = Math.min(card.span, columns);
    if (card.startsNewRow && columnStart !== 0) {
      row += 1;
      columnStart = 0;
    }
    if (columnStart + span > columns) {
      row += 1;
      columnStart = 0;
    }
    const packed = { id: card.id, row, columnStart, span };
    columnStart += span;
    if (columnStart === columns) {
      row += 1;
      columnStart = 0;
    }
    return packed;
  });
}

function cellsAreFree(
  packed: PackedCard[],
  row: number,
  columnStart: number,
  span: number,
): boolean {
  const occupied = new Set(
    packed.flatMap((card) =>
      Array.from({ length: card.span }, (_, offset) =>
        `${card.row}:${card.columnStart + offset}`,
      ),
    ),
  );
  return Array.from(
    { length: span },
    (_, offset) => `${row}:${columnStart + offset}`,
  ).every((cell) => !occupied.has(cell));
}

export function planDropCandidates(input: {
  cards: LayoutCard[];
  draggedId: string;
  columns: 1 | 2 | 3;
  allowAdaptiveShrink: boolean;
}): DropPlan {
  const visibleCards = input.cards.filter((card) => !card.hidden);
  const draggedCard = visibleCards.find((card) => card.id === input.draggedId);
  if (!draggedCard) return { candidates: [] };

  const remaining = visibleCards.filter((card) => card.id !== input.draggedId);
  const packedRemaining = packLayout(remaining, input.columns);
  const candidates: DropCandidate[] = [];
  const spans: CardSpan[] = input.allowAdaptiveShrink && input.columns === 3
    ? Array.from({ length: draggedCard.span }, (_, index) =>
        (draggedCard.span - index) as CardSpan,
      )
    : [draggedCard.span];

  for (let insertIndex = 0; insertIndex <= remaining.length; insertIndex += 1) {
    for (const span of spans) {
      const nextCards = [
        ...remaining.slice(0, insertIndex),
        { ...draggedCard, span, startsNewRow: undefined },
        ...remaining.slice(insertIndex),
      ];
      const position = packLayout(nextCards, input.columns).find(
        (card) => card.id === input.draggedId,
      );
      if (!position) continue;

      const isShrink = span < draggedCard.span;
      const isExistingRow = packedRemaining.some((card) => card.row === position.row);
      const fillsGap =
        isExistingRow &&
        cellsAreFree(
          packedRemaining,
          position.row,
          position.columnStart,
          position.span,
        );
      if (isShrink && !fillsGap) continue;
      const originalVisualSpan = Math.min(draggedCard.span, input.columns);
      const originalSpanFitsHere =
        position.columnStart + originalVisualSpan <= input.columns &&
        cellsAreFree(
          packedRemaining,
          position.row,
          position.columnStart,
          originalVisualSpan,
        );
      if (isShrink && originalSpanFitsHere) continue;
      const lastRemainingRow = packedRemaining.reduce(
        (lastRow, card) => Math.max(lastRow, card.row),
        -1,
      );
      const startsNewRow =
        !isShrink &&
        insertIndex === remaining.length &&
        position.row > lastRemainingRow;

      candidates.push({
        id: `drop:${insertIndex}:${span}:${startsNewRow ? 1 : 0}`,
        draggedId: input.draggedId,
        kind: startsNewRow ? "new-row" : fillsGap ? "fill-gap" : "reorder",
        insertIndex,
        row: position.row,
        columnStart: position.columnStart,
        span,
        previousSpan: draggedCard.span,
        startsNewRow,
      });
    }
  }

  if (remaining.length > 0) {
    const forcedNewRowCards = [
      ...remaining,
      {
        ...draggedCard,
        span: draggedCard.span,
        startsNewRow: true,
      },
    ];
    const position = packLayout(forcedNewRowCards, input.columns).find(
      (card) => card.id === input.draggedId,
    );
    if (position) {
      candidates.push({
        id: `drop:${remaining.length}:${draggedCard.span}:1`,
        draggedId: input.draggedId,
        kind: "new-row",
        insertIndex: remaining.length,
        row: position.row,
        columnStart: position.columnStart,
        span: draggedCard.span,
        previousSpan: draggedCard.span,
        startsNewRow: true,
      });
    }
  }

  const uniqueCandidates = new Map<string, DropCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.row}:${candidate.columnStart}`;
    if (!uniqueCandidates.has(key)) uniqueCandidates.set(key, candidate);
  }
  return { candidates: [...uniqueCandidates.values()] };
}

export function applyDropCandidate<T extends LayoutCard>(
  cards: T[],
  candidate: DropCandidate,
): T[] {
  const draggedCard = cards.find((card) => card.id === candidate.draggedId);
  if (!draggedCard || draggedCard.hidden) return cards;

  const visibleCards = cards.filter((card) => !card.hidden);
  const remaining = visibleCards.filter((card) => card.id !== candidate.draggedId);
  const insertIndex = Math.max(
    0,
    Math.min(candidate.insertIndex, remaining.length),
  );
  const nextDraggedCard = {
    ...draggedCard,
    span: candidate.span,
    startsNewRow: candidate.startsNewRow || undefined,
  };
  const nextVisibleCards = [
    ...remaining.slice(0, insertIndex),
    nextDraggedCard,
    ...remaining.slice(insertIndex),
  ];
  let visibleIndex = 0;
  return cards.map((card) =>
    card.hidden ? card : (nextVisibleCards[visibleIndex++] as T),
  );
}
