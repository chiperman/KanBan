import { expect, test } from "@playwright/test";

import {
  applyDropCandidate,
  planDropCandidates,
} from "@/ui/card-layout/card-layout-planner";

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

  expect(candidate).toMatchObject({
    kind: "fill-gap",
    previousSpan: 3,
    startsNewRow: false,
  });
  expect(applyDropCandidate(cards, candidate!)).toEqual([
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

  const newRowCandidates = plan.candidates.filter(
    (candidate) => candidate.kind === "new-row",
  );
  expect(newRowCandidates).toEqual([
    expect.objectContaining({
      insertIndex: 1,
      span: 3,
      previousSpan: 3,
      startsNewRow: true,
    }),
  ]);
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

  expect(
    plan.candidates.filter(
      (candidate) => candidate.row === 0 && candidate.columnStart === 1,
    ),
  ).toEqual([
    expect.objectContaining({ span: 2, previousSpan: 2 }),
  ]);
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
  const firstCandidate = plan.candidates.find(
    (candidate) => candidate.insertIndex === 0 && candidate.span === 1,
  );

  expect(applyDropCandidate(cards, firstCandidate!)).toEqual([
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
    expect(plan.candidates.length).toBeGreaterThan(0);
    expect(plan.candidates.every((candidate) => candidate.span === 3)).toBe(true);
  }
});

test("末行仍有空位时也生成强制新行候选", () => {
  const cards = [
    { id: "first", span: 1 as const },
    { id: "second", span: 1 as const },
    { id: "dragged", span: 1 as const },
  ];
  const plan = planDropCandidates({
    cards,
    draggedId: "dragged",
    columns: 3,
    allowAdaptiveShrink: true,
  });

  expect(plan.candidates).toContainEqual(
    expect.objectContaining({
      kind: "new-row",
      insertIndex: 2,
      row: 1,
      columnStart: 0,
      span: 1,
      startsNewRow: true,
    }),
  );
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
  const sameAnchor = plan.candidates.filter(
    (candidate) => candidate.row === 0 && candidate.columnStart === 1,
  );

  expect(sameAnchor).toHaveLength(1);
  expect(sameAnchor[0].span).toBe(2);
});
