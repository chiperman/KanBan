import { expect, test } from "@playwright/test";

import { updateActiveDropCandidate } from "@/ui/card-layout/card-layout-editor";

test("相同或瞬时丢失的候选不会重置拖动预览", () => {
  const session = {
    activeCandidateId: "drop:before",
    plan: {
      candidates: [
        {
          id: "drop:before",
          draggedId: "dragged",
          kind: "reorder" as const,
          insertIndex: 0,
          row: 0,
          columnStart: 0,
          span: 1 as const,
          previousSpan: 1 as const,
          startsNewRow: false,
        },
        {
          id: "drop:after",
          draggedId: "dragged",
          kind: "reorder" as const,
          insertIndex: 1,
          row: 0,
          columnStart: 1,
          span: 1 as const,
          previousSpan: 1 as const,
          startsNewRow: false,
        },
      ],
    },
  };

  expect(updateActiveDropCandidate(session, "drop:before")).toBe(session);
  expect(updateActiveDropCandidate(session, null)).toBe(session);
  expect(updateActiveDropCandidate(session, "drop:after")).toEqual({
    ...session,
    activeCandidateId: "drop:after",
  });
});
