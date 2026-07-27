"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  rectIntersection,
  pointerWithin,
  useDraggable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  type KeyboardCoordinateGetter,
  type Modifier,
} from "@dnd-kit/core";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";

import type { Card } from "@/server/ports";
import { CardDropZoneLayer } from "@/ui/card-layout/card-drop-zone-layer";
import {
  applyDropCandidate,
  planDropCandidates,
  type DropCandidate,
  type DropPlan,
} from "@/ui/card-layout/card-layout-planner";

export type CardDragControls = {
  cardRef: Ref<HTMLElement>;
  handleRef: Ref<HTMLButtonElement>;
  handleAttributes: DraggableAttributes;
  handleListeners: DraggableSyntheticListeners;
  isDragging: boolean;
  disabled: boolean;
};

type DragSession = {
  draggedId: string;
  originalCards: Card[];
  plan: DropPlan;
  activeCandidateId: string | null;
};

function sameCardIds(left: Card[], right: Card[]): boolean {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right.map(({ id }) => id));
  return left.every(({ id }) => rightIds.has(id));
}

const candidateCollisionDetection: CollisionDetection = (args) => {
  const pointerHits = pointerWithin(args);
  if (pointerHits.length > 0) return pointerHits;
  return rectIntersection(args);
};

const candidateKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  {
    currentCoordinates,
    context: { droppableRects, droppableContainers, over },
  },
) => {
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
    return undefined;
  }
  event.preventDefault();
  const candidates = droppableContainers
    .getEnabled()
    .flatMap((container) => {
      const candidate = container.data.current?.candidate as
        | DropCandidate
        | undefined;
      const rect = droppableRects.get(container.id);
      return candidate && rect ? [{ candidate, rect }] : [];
    })
    .sort((left, right) =>
      left.candidate.row - right.candidate.row ||
      left.candidate.columnStart - right.candidate.columnStart ||
      left.candidate.span - right.candidate.span,
    );
  if (candidates.length === 0) return currentCoordinates;
  const current = over
    ? candidates.find(({ candidate }) => candidate.id === over.id)
    : candidates
        .map((item) => {
          const center = {
            x: item.rect.left + item.rect.width / 2,
            y: item.rect.top + item.rect.height / 2,
          };
          return {
            ...item,
            distance: Math.hypot(
              center.x - currentCoordinates.x,
              center.y - currentCoordinates.y,
            ),
          };
        })
        .sort((left, right) => left.distance - right.distance)[0];
  const origin = current
    ? {
        x: current.candidate.columnStart + current.candidate.span / 2,
        y: current.candidate.row,
      }
    : currentCoordinates;
  const horizontal = event.code === "ArrowLeft" || event.code === "ArrowRight";
  const positive = event.code === "ArrowRight" || event.code === "ArrowDown";
  const directional = candidates
    .map((item) => {
      const center = {
        x: item.rect.left + item.rect.width / 2,
        y: item.rect.top + item.rect.height / 2,
      };
      const logicalCenter = {
        x: item.candidate.columnStart + item.candidate.span / 2,
        y: item.candidate.row,
      };
      const primaryDelta = horizontal
        ? logicalCenter.x - origin.x
        : logicalCenter.y - origin.y;
      const secondaryDelta = horizontal
        ? logicalCenter.y - origin.y
        : logicalCenter.x - origin.x;
      return { ...item, center, primaryDelta, secondaryDelta };
    })
    .filter(({ candidate, primaryDelta }) =>
      candidate.id !== current?.candidate.id &&
      (positive ? primaryDelta > 1 : primaryDelta < -1),
    )
    .sort((left, right) =>
      Math.abs(left.primaryDelta) - Math.abs(right.primaryDelta) ||
      Math.abs(left.secondaryDelta) - Math.abs(right.secondaryDelta),
    );
  const next = directional[0];
  if (!next) return currentCoordinates;
  return {
    x: next.center.x,
    y: next.center.y,
  };
};

function DraggableCard({
  card,
  disabled,
  renderCard,
}: {
  card: Card;
  disabled: boolean;
  renderCard(card: Card, controls: CardDragControls): ReactNode;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    isDragging,
  } = useDraggable({ id: card.id, disabled });
  return renderCard(card, {
    cardRef: setNodeRef,
    handleRef: setActivatorNodeRef,
    handleAttributes: attributes,
    handleListeners: listeners,
    isDragging,
    disabled,
  });
}

export function CardLayoutEditor({
  cards,
  renderCard,
  renderOverlay,
  gridOverlay,
  onCommit,
  onCardsChangedDuringDrag,
}: {
  cards: Card[];
  renderCard(card: Card, controls: CardDragControls): ReactNode;
  renderOverlay(card: Card): ReactNode;
  gridOverlay?: ReactNode;
  onCommit(nextCards: Card[], previousCards: Card[]): Promise<void>;
  onCardsChangedDuringDrag(): void;
}) {
  const gridRef = useRef<HTMLElement>(null);
  const measurementRef = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<DragSession | null>(null);
  const [saving, setSaving] = useState(false);
  const [overlayWidth, setOverlayWidth] = useState<number | null>(null);
  const [overlayHeight, setOverlayHeight] = useState<number | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: candidateKeyboardCoordinates }),
  );
  const activeCandidate = session?.plan.candidates.find(
    ({ id }) => id === session.activeCandidateId,
  ) ?? null;
  const visibleCards = cards.filter((card) => !card.hidden);
  const draggedCard = session
    ? session.originalCards.find(({ id }) => id === session.draggedId) ?? null
    : null;
  const overlayCard = draggedCard && activeCandidate
    ? { ...draggedCard, span: activeCandidate.span }
    : draggedCard;
  const overlayModifiers = useMemo<Modifier[]>(
    () => [
      ({ transform, activeNodeRect }) => ({
        ...transform,
        x:
          transform.x +
          (activeNodeRect && overlayWidth !== null
            ? Math.max(0, activeNodeRect.width - overlayWidth)
            : 0),
      }),
    ],
    [overlayWidth],
  );

  useEffect(() => {
    if (!session || sameCardIds(cards, session.originalCards)) return;
    setSession(null);
    onCardsChangedDuringDrag();
  }, [cards, onCardsChangedDuringDrag, session]);

  useEffect(() => {
    if (!session) return;
    const navigate = (event: globalThis.KeyboardEvent) => {
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
      const current = session.plan.candidates.find(
        ({ id }) => id === session.activeCandidateId,
      );
      if (!current) return;
      const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
      const positive = event.key === "ArrowRight" || event.key === "ArrowDown";
      const origin = {
        x: current.columnStart + current.span / 2,
        y: current.row,
      };
      const next = session.plan.candidates
        .filter(({ id }) => id !== current.id)
        .map((candidate) => {
          const center = {
            x: candidate.columnStart + candidate.span / 2,
            y: candidate.row,
          };
          const primaryDelta = horizontal ? center.x - origin.x : center.y - origin.y;
          const secondaryDelta = horizontal ? center.y - origin.y : center.x - origin.x;
          return { candidate, primaryDelta, secondaryDelta };
        })
        .filter(({ primaryDelta }) => positive ? primaryDelta > 0 : primaryDelta < 0)
        .sort((left, right) =>
          Math.abs(left.primaryDelta) - Math.abs(right.primaryDelta) ||
          Math.abs(left.secondaryDelta) - Math.abs(right.secondaryDelta),
        )[0]?.candidate;
      if (!next) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setSession((value) => value ? { ...value, activeCandidateId: next.id } : null);
    };
    window.addEventListener("keydown", navigate, true);
    return () => window.removeEventListener("keydown", navigate, true);
  }, [session]);

  useLayoutEffect(() => {
    if (!session) {
      setOverlayWidth(null);
      return;
    }
    const frame = requestAnimationFrame(() => {
      const grid = gridRef.current;
      if (!grid) return;
      const style = window.getComputedStyle(grid);
      const columns = style.gridTemplateColumns.trim().split(/\s+/).length;
      const gap = Number.parseFloat(style.columnGap) || 0;
      const gridBox = grid.getBoundingClientRect();
      const columnWidth = (gridBox.width - gap * (columns - 1)) / columns;
      const visualSpan = Math.min(
        activeCandidate?.span ?? draggedCard?.span ?? 1,
        columns,
      );
      setOverlayWidth(
        visualSpan * columnWidth + Math.max(0, visualSpan - 1) * gap,
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [activeCandidate, draggedCard, session]);

  useLayoutEffect(() => {
    const element = measurementRef.current;
    if (!element) {
      setOverlayHeight(null);
      return;
    }
    const measure = () => setOverlayHeight(element.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [overlayCard, overlayWidth]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={candidateCollisionDetection}
      accessibility={{
        announcements: {
          onDragStart({ active }) {
            const card = cards.find(({ id }) => id === active.id);
            return card ? `已拿起${card.title}，当前宽度 ${card.span} 格。` : "已拿起资产卡片。";
          },
          onDragOver({ over }) {
            const candidate = session?.plan.candidates.find(({ id }) => id === over?.id);
            return candidate
              ? `候选：第 ${candidate.row + 1} 行第 ${candidate.columnStart + 1} 列，宽度 ${candidate.previousSpan} 到 ${candidate.span} 格。`
              : "当前不在合法候选区域。";
          },
          onDragEnd() {
            return "已放置资产卡片。";
          },
          onDragCancel() {
            return "已取消资产卡片移动。";
          },
        },
      }}
      onDragStart={({ active }) => {
        const draggedId = String(active.id);
        setSession({
          draggedId,
          originalCards: cards,
          plan: planDropCandidates({
            cards,
            draggedId,
            columns: window.matchMedia("(max-width: 639px)").matches
              ? 1
              : window.matchMedia("(max-width: 1023px)").matches
                ? 2
                : 3,
            allowAdaptiveShrink: !window.matchMedia("(max-width: 1023px)").matches,
          }),
          activeCandidateId: null,
        });
      }}
      onDragOver={({ over }) => {
        setSession((current) =>
          current
            ? {
                ...current,
                activeCandidateId: over && current.plan.candidates.some(({ id }) => id === over.id)
                  ? String(over.id)
                  : null,
              }
            : null,
        );
      }}
      onDragCancel={() => setSession(null)}
      onDragEnd={({ over }) => {
        if (!session || !over || !sameCardIds(cards, session.originalCards)) {
          if (session && !sameCardIds(cards, session.originalCards)) onCardsChangedDuringDrag();
          setSession(null);
          return;
        }
        const candidate = session.plan.candidates.find(
          ({ id }) => id === session.activeCandidateId,
        ) ?? session.plan.candidates.find(({ id }) => id === over.id);
        if (!candidate) {
          setSession(null);
          return;
        }
        const previousCards = session.originalCards;
        const nextCards = applyDropCandidate(previousCards, candidate);
        setSession(null);
        setSaving(true);
        void onCommit(nextCards, previousCards).finally(() => setSaving(false));
      }}
    >
      <section className="card-grid" data-testid="card-grid" ref={gridRef}>
        {gridOverlay}
        {visibleCards.map((card) => (
          <DraggableCard
            key={card.id}
            card={card}
            disabled={saving}
            renderCard={renderCard}
          />
        ))}
        {session ? (
          <CardDropZoneLayer
            gridRef={gridRef}
            candidates={session.plan.candidates}
            activeCandidateId={session.activeCandidateId}
            activeHeight={overlayHeight}
          />
        ) : null}
      </section>
      {overlayCard && overlayWidth !== null ? (
        <div
          ref={measurementRef}
          className={`card card-drag-measurement span-${activeCandidate?.span ?? overlayCard.span}`}
          aria-hidden="true"
          style={{ width: overlayWidth }}
        >
          {renderOverlay(overlayCard)}
        </div>
      ) : null}
      <DragOverlay dropAnimation={null} modifiers={overlayModifiers}>
        {overlayCard ? (
          <div
            className={`card card-drag-overlay span-${activeCandidate?.span ?? overlayCard.span}`}
            data-testid="card-drag-overlay"
            aria-hidden="true"
            style={overlayWidth === null ? undefined : { width: overlayWidth }}
          >
            {renderOverlay(overlayCard)}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
