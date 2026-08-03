"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import type { DropCandidate } from "@/ui/card-layout/card-layout-planner";

export type DropZoneGeometry = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type CandidateGeometry = {
  target: DropZoneGeometry;
  preview: DropZoneGeometry;
};

export function calculateDropCandidateGeometries(
  candidates: DropCandidate[],
  {
    columns,
    contentBottom,
    gap,
    gridWidth,
    rows,
  }: {
    columns: number;
    contentBottom: number;
    gap: number;
    gridWidth: number;
    rows: Array<{ top: number; height: number }>;
  },
  activeHeight: number | null,
): Map<string, CandidateGeometry> {
  const columnWidth = (gridWidth - gap * (columns - 1)) / columns;
  const nextRowTop = contentBottom + gap;
  const newRowHeight = Math.max(72, activeHeight ?? 0);
  const geometries = new Map<string, CandidateGeometry>();

  for (const candidate of candidates) {
    const row = rows[candidate.row];
    const visualSpan = Math.min(candidate.span, columns);
    const newRow = candidate.kind === "new-row";
    const top = newRow ? nextRowTop : row?.top ?? nextRowTop;
    const height = newRow ? newRowHeight : row?.height ?? 72;
    const previewWidth =
      visualSpan * columnWidth +
      Math.max(0, visualSpan - 1) * gap;
    geometries.set(candidate.id, {
      target: {
        left: newRow ? 0 : candidate.columnStart * (columnWidth + gap),
        top,
        width: newRow ? gridWidth : columnWidth,
        height,
      },
      preview: {
        left: candidate.columnStart * (columnWidth + gap),
        top,
        width: previewWidth,
        height,
      },
    });
  }

  return geometries;
}

function CandidateDropZone({
  candidate,
  geometry,
  active,
  activeHeight,
}: {
  candidate: DropCandidate;
  geometry: CandidateGeometry;
  active: boolean;
  activeHeight: number | null;
}) {
  const { setNodeRef } = useDroppable({
    id: candidate.id,
    data: { candidate },
  });
  const spanChange = candidate.span === candidate.previousSpan
    ? `SPAN ${candidate.span}`
    : `SPAN ${candidate.previousSpan} → ${candidate.span}`;

  const label = candidate.kind === "new-row"
    ? `${spanChange} · 松开后另起一行`
    : `${spanChange} · COL ${candidate.columnStart + 1}`;

  return (
    <>
      <div
        ref={setNodeRef}
        className={[
          "card-drop-candidate",
          candidate.kind === "new-row" ? "is-new-row" : "",
          active ? "is-active" : "",
        ].filter(Boolean).join(" ")}
        data-testid="card-drop-candidate"
        data-vibe-state="drop-candidate"
        data-candidate-id={candidate.id}
        data-candidate-kind={candidate.kind}
        data-candidate-span={candidate.span}
        data-candidate-row={candidate.row}
        data-candidate-column={candidate.columnStart}
        aria-hidden="true"
        style={geometry.target}
      >
        <span>{label}</span>
      </div>
      {active ? (
        <div
          className={`card-drop-preview card-drop-slot span-${candidate.span}`}
          data-testid="layout-drop-slot"
          data-vibe-state="drop-preview"
          data-candidate-kind={candidate.kind}
          data-candidate-span={candidate.span}
          aria-hidden="true"
          style={{
            ...geometry.preview,
            height: activeHeight ?? geometry.preview.height,
          }}
        >
          <span>{label}</span>
        </div>
      ) : null}
    </>
  );
}

export function CardDropZoneLayer({
  gridRef,
  candidates,
  activeCandidateId,
  activeHeight,
}: {
  gridRef: RefObject<HTMLElement | null>;
  candidates: DropCandidate[];
  activeCandidateId: string | null;
  activeHeight: number | null;
}) {
  const [geometries, setGeometries] = useState(
    new Map<string, CandidateGeometry>(),
  );
  const measuredWidthRef = useRef<number | null>(null);

  const measure = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const gridBox = grid.getBoundingClientRect();
    measuredWidthRef.current = gridBox.width;
    const style = window.getComputedStyle(grid);
    const columns = style.gridTemplateColumns.trim().split(/\s+/).length;
    const gap = Number.parseFloat(style.columnGap) || 0;
    const measuredCards = [
      ...grid.querySelectorAll<HTMLElement>("[data-layout-card-id]"),
    ].map((element) => ({
      dragging: element.classList.contains("card-dragging"),
      box: element.getBoundingClientRect(),
    }));
    const cardBoxes = measuredCards.map(({ box }) => box);
    const rowTops = [...new Set(cardBoxes.map((box) => Math.round(box.top)))].sort(
      (left, right) => left - right,
    );
    const rows = rowTops.map((top) => {
      const boxes = cardBoxes.filter((box) => Math.abs(box.top - top) <= 2);
      return {
        top: top - gridBox.top,
        height: Math.max(72, ...boxes.map((box) => box.height)),
      };
    });
    const contentBottom = measuredCards.reduce(
      (bottom, { box, dragging }) =>
        dragging ? bottom : Math.max(bottom, box.bottom - gridBox.top),
      0,
    );
    setGeometries(calculateDropCandidateGeometries(
      candidates,
      {
        columns,
        contentBottom,
        gap,
        gridWidth: gridBox.width,
        rows,
      },
      activeHeight,
    ));
  }, [activeHeight, candidates, gridRef]);

  const measureIfWidthChanged = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const width = grid.getBoundingClientRect().width;
    if (
      measuredWidthRef.current !== null &&
      Math.abs(measuredWidthRef.current - width) < 1
    ) {
      return;
    }
    measure();
  }, [gridRef, measure]);

  useLayoutEffect(() => {
    measure();
    const grid = gridRef.current;
    const observer = grid ? new ResizeObserver(measureIfWidthChanged) : null;
    if (grid) observer?.observe(grid);
    window.addEventListener("resize", measureIfWidthChanged);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measureIfWidthChanged);
    };
  }, [gridRef, measure, measureIfWidthChanged]);

  return (
    <div className="card-drop-zone-layer" aria-hidden="true">
      {candidates.map((candidate) => {
        const geometry = geometries.get(candidate.id);
        return geometry ? (
          <CandidateDropZone
            key={candidate.id}
            candidate={candidate}
            geometry={geometry}
            active={candidate.id === activeCandidateId}
            activeHeight={activeHeight}
          />
        ) : null;
      })}
    </div>
  );
}
