import assert from "node:assert/strict";
import test from "node:test";

import {
  applyDropCandidate,
  planDropCandidates,
} from "./card-layout-planner";

test("三格资产卡片可以缩小到两格卡片右侧的一格空位", () => {
  const cards = [
    { id: "longbridge", span: 2 as const },
    { id: "demo", span: 3 as const },
  ];
  const plan = planDropCandidates({
    cards,
    draggedId: "demo",
    columns: 3,
    allowAdaptiveShrink: true,
  });
  const candidate = plan.candidates.find(
    (item) =>
      item.row === 0 && item.columnStart === 2 && item.span === 1,
  );

  assert.ok(candidate);
  assert.deepEqual(
    {
      kind: candidate.kind,
      previousSpan: candidate.previousSpan,
      startsNewRow: candidate.startsNewRow,
    },
    { kind: "fill-gap", previousSpan: 3, startsNewRow: false },
  );
  assert.deepEqual(applyDropCandidate(cards, candidate), [
    cards[0],
    { id: "demo", span: 1, startsNewRow: undefined },
  ]);
});

test("空白新行候选保持资产卡片原跨度", () => {
  const plan = planDropCandidates({
    cards: [
      { id: "first", span: 2 },
      { id: "dragged", span: 3 },
    ],
    draggedId: "dragged",
    columns: 3,
    allowAdaptiveShrink: true,
  });
  const candidates = plan.candidates.filter(
    (candidate) => candidate.kind === "new-row",
  );

  assert.equal(candidates.length, 1);
  assert.deepEqual(
    {
      insertIndex: candidates[0].insertIndex,
      span: candidates[0].span,
      previousSpan: candidates[0].previousSpan,
      startsNewRow: candidates[0].startsNewRow,
    },
    { insertIndex: 1, span: 3, previousSpan: 3, startsNewRow: true },
  );
});

test("原跨度能放入连续空位时不生成同位置缩小候选", () => {
  const plan = planDropCandidates({
    cards: [
      { id: "first", span: 1 },
      { id: "dragged", span: 2 },
    ],
    draggedId: "dragged",
    columns: 3,
    allowAdaptiveShrink: true,
  });
  const candidates = plan.candidates.filter(
    (candidate) => candidate.row === 0 && candidate.columnStart === 1,
  );

  assert.deepEqual(
    candidates.map(({ span, previousSpan }) => ({ span, previousSpan })),
    [{ span: 2, previousSpan: 2 }],
  );
});

test("可见资产卡片重排时隐藏卡片保持原有槽位", () => {
  const hidden = { id: "hidden", span: 1 as const, hidden: true };
  const cards = [
    { id: "first", span: 1 as const },
    hidden,
    { id: "dragged", span: 1 as const },
  ];
  const plan = planDropCandidates({
    cards,
    draggedId: "dragged",
    columns: 3,
    allowAdaptiveShrink: true,
  });
  const candidate = plan.candidates.find(
    (item) => item.insertIndex === 0 && item.span === 1,
  );

  assert.ok(candidate);
  assert.deepEqual(applyDropCandidate(cards, candidate), [
    { id: "dragged", span: 1, startsNewRow: undefined },
    hidden,
    cards[0],
  ]);
});

test("两列和单列候选不改写桌面持久化跨度", () => {
  for (const columns of [2, 1] as const) {
    const plan = planDropCandidates({
      cards: [
        { id: "first", span: 1 },
        { id: "dragged", span: 3 },
      ],
      draggedId: "dragged",
      columns,
      allowAdaptiveShrink: false,
    });

    assert.ok(plan.candidates.length > 0);
    assert.ok(plan.candidates.every((candidate) => candidate.span === 3));
  }
});

test("末行仍有空位时也生成强制新行候选", () => {
  const plan = planDropCandidates({
    cards: [
      { id: "first", span: 1 },
      { id: "second", span: 1 },
      { id: "dragged", span: 1 },
    ],
    draggedId: "dragged",
    columns: 3,
    allowAdaptiveShrink: true,
  });
  const candidate = plan.candidates.find(
    (item) =>
      item.kind === "new-row" &&
      item.insertIndex === 2 &&
      item.row === 1 &&
      item.columnStart === 0 &&
      item.span === 1 &&
      item.startsNewRow,
  );

  assert.ok(candidate);
});

test("同一位置只保留能放下的最大跨度候选", () => {
  const plan = planDropCandidates({
    cards: [
      { id: "anchor", span: 1 },
      { id: "dragged", span: 3 },
    ],
    draggedId: "dragged",
    columns: 3,
    allowAdaptiveShrink: true,
  });
  const candidates = plan.candidates.filter(
    (candidate) => candidate.row === 0 && candidate.columnStart === 1,
  );

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].span, 2);
});
