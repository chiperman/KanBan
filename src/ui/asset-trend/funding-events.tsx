import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Curve, ZIndexLayer, useXAxisScale, useYAxisScale } from "recharts";

import { FUNDING_EVENT_Z_INDEX, type AssetTrendChartPoint, type AssetTrendEvent } from "./shared";

export function FundingEventMarker({
  cx,
  cy,
  kinds,
}: {
  cx?: number;
  cy?: number;
  kinds: AssetTrendEvent["kind"][];
}) {
  if (cx === undefined || cy === undefined) return <g />;
  const deposit = kinds.includes("deposit");
  const withdrawal = kinds.includes("withdrawal");
  const radius = withdrawal ? (deposit ? 6 : 4.5) : deposit ? 4 : 2.5;

  return (
    <g aria-hidden="true" pointerEvents="none">
      <circle cx={cx} cy={cy} fill="var(--surface)" r={radius + 2.5} />
      <circle
        cx={cx}
        cy={cy}
        fill={withdrawal ? "var(--surface)" : deposit ? "var(--display)" : "var(--secondary)"}
        r={radius}
        stroke={withdrawal ? "var(--display)" : "none"}
        strokeWidth={1.5}
      />
      {deposit && withdrawal ? <circle cx={cx} cy={cy} fill="var(--display)" r={3} /> : null}
    </g>
  );
}

type CurveFundingMarker = {
  day: string;
  cx: number;
  cy: number;
  kinds: AssetTrendEvent["kind"][];
};

/** Measure the rendered curve in pixels without filling missing financial values. */
export function FundingEventOverlay({
  points,
  dataKey,
  type = "monotone",
}: {
  points: (AssetTrendChartPoint & { value?: number | null; assets?: number | null })[];
  dataKey: "value" | "assets";
  type?: "linear" | "monotone" | "stepAfter";
}) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  const pathRef = useRef<SVGPathElement>(null);
  const [markers, setMarkers] = useState<CurveFundingMarker[]>([]);
  const curvePoints = useMemo(
    () => points.map((point) => ({
      x: xScale?.(point.day) ?? null,
      y: point[dataKey] == null ? null : yScale?.(point[dataKey]) ?? null,
      payload: point,
    })),
    [points, dataKey, xScale, yScale],
  );

  useLayoutEffect(() => {
    const first = curvePoints.find((point) => point.x !== null && point.y !== null);
    const last = curvePoints.findLast((point) => point.x !== null && point.y !== null);
    const path = pathRef.current;
    if (first?.x == null || last?.x == null) {
      setMarkers([]);
      return;
    }

    const length = path?.getTotalLength() ?? 0;
    const nextMarkers: CurveFundingMarker[] = [];
    for (const point of curvePoints) {
      if (!point.payload.events?.length || point.x === null || point.x < first.x || point.x > last.x) continue;
      let cy = point.y;
      if (cy === null) {
        if (!path || length === 0) continue;
        let lower = 0;
        let upper = length;
        for (let iteration = 0; iteration < 28; iteration += 1) {
          const middle = (lower + upper) / 2;
          if (path.getPointAtLength(middle).x < point.x) lower = middle;
          else upper = middle;
        }
        cy = path.getPointAtLength((lower + upper) / 2).y;
      }
      nextMarkers.push({
        day: point.payload.day,
        cx: point.x,
        cy,
        kinds: point.payload.events.map((event) => event.kind),
      });
    }
    setMarkers(nextMarkers);
  }, [curvePoints, type]);

  return (
    <>
      <Curve
        aria-hidden="true"
        connectNulls
        fill="none"
        pathRef={pathRef}
        pointerEvents="none"
        points={curvePoints}
        stroke="none"
        type={type}
      />
      <ZIndexLayer zIndex={FUNDING_EVENT_Z_INDEX}>
        {markers.map((marker) => (
          <g className="recharts-reference-dot" key={`funding-event:${marker.day}`}>
            <FundingEventMarker {...marker} />
          </g>
        ))}
      </ZIndexLayer>
    </>
  );
}

export function FundingEventLegend({ points }: { points: AssetTrendChartPoint[] }) {
  if (!points.some((point) => point.events?.some((event) => event.kind !== "opening"))) return null;

  return (
    <div aria-label="资金标记" className="asset-trend-event-legend">
      {(["deposit", "withdrawal"] as const).map((kind) => (
        <span key={kind}>
          <svg aria-hidden="true" height={16} viewBox="0 0 20 20" width={16}>
            <FundingEventMarker cx={10} cy={10} kinds={[kind]} />
          </svg>
          {kind === "deposit" ? "入金" : "出金"}
        </span>
      ))}
    </div>
  );
}
