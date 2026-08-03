import { expect, test } from "@playwright/test";

import { calculateDropCandidateGeometries } from "@/ui/card-layout/card-drop-zone-layer";

test("新起一行的投放区固定显示在现有卡片之后", () => {
  const geometries = calculateDropCandidateGeometries(
    [
      {
        id: "drop:new-row",
        draggedId: "dragged",
        kind: "new-row",
        insertIndex: 4,
        row: 2,
        columnStart: 0,
        span: 2,
        previousSpan: 2,
        startsNewRow: true,
      },
    ],
    {
      columns: 3,
      contentBottom: 428,
      gap: 16,
      gridWidth: 900,
      rows: [
        { top: 0, height: 180 },
        { top: 196, height: 216 },
        { top: 428, height: 150 },
      ],
    },
    184,
  );

  expect(geometries.get("drop:new-row")).toEqual({
    target: {
      left: 0,
      top: 444,
      width: 900,
      height: 184,
    },
    preview: {
      left: 0,
      top: 444,
      width: (900 - 16 * 2) / 3 * 2 + 16,
      height: 184,
    },
  });
});
