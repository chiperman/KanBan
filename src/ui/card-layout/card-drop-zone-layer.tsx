"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  useCallback,
  useLayoutEffect,
  useState,
  type RefObject,
} from "react";

import type { DropCandidate } from "@/ui/card-layout/card-layout-planner";

type DropZoneGeometry = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type CandidateGeometry = {
  target: DropZoneGeometry;
  preview: DropZoneGeometry;
};

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
    ? `${spanChange} · 新起一行`
    : `${spanChange} · COL ${candidate.columnStart + 1}`;

  return (
    <>
      <div
        ref={setNodeRef}
        className={`card-drop-candidate${active ? " is-active" : ""}`}
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

  const measure = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const gridBox = grid.getBoundingClientRect();
    const style = window.getComputedStyle(grid);
    const columns = style.gridTemplateColumns.trim().split(/\s+/).length;
    const gap = Number.parseFloat(style.columnGap) || 0;
    const columnWidth = (gridBox.width - gap * (columns - 1)) / columns;
    const cardBoxes = [
      ...grid.querySelectorAll<HTMLElement>("[data-layout-card-id]"),
    ].map((element) => element.getBoundingClientRect());
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
    const contentBottom = cardBoxes.reduce(
      (bottom, box) => Math.max(bottom, box.bottom - gridBox.top),
      0,
    );
    const nextRowTop = contentBottom + gap;
    const next = new Map<string, CandidateGeometry>();

    for (const candidate of candidates) {
      const row = rows[candidate.row];
      const visualSpan = Math.min(candidate.span, columns);
      const top = row?.top ?? nextRowTop;
      const rowHeight = row?.height ?? 72;
      const previewWidth =
        visualSpan * columnWidth +
        Math.max(0, visualSpan - 1) * gap;
      next.set(candidate.id, {
        target: {
          left: candidate.kind === "new-row"
            ? 0
            : candidate.columnStart * (columnWidth + gap),
          top,
          width: candidate.kind === "new-row" ? gridBox.width : columnWidth,
          height: rowHeight,
        },
        preview: {
          left: candidate.columnStart * (columnWidth + gap),
          top,
          width: previewWidth,
          height: rowHeight,
        },
      });
    }
    setGeometries(next);
  }, [candidates, gridRef]);

  useLayoutEffect(() => {
    measure();
    const frame = requestAnimationFrame(measure);
    const grid = gridRef.current;
    const observer = grid ? new ResizeObserver(measure) : null;
    if (grid) observer?.observe(grid);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [gridRef, measure]);

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
