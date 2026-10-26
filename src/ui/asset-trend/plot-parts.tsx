import { Line, usePlotArea } from "recharts";

import { TrendDotPattern } from "@/ui/trend-dot-pattern";

import { TREND_CHART_ANIMATION_DURATION } from "./shared";

type CurveLineProps = {
  dataKey: string;
  stroke: string;
  type?: "linear" | "monotone" | "stepAfter";
  activeDot?: boolean;
  connectNulls?: boolean;
  dot?: boolean;
  filter?: string;
  strokeDasharray?: string;
  strokeWidth?: number;
  name?: string;
};

/* The end marker is presentational and never participates in tooltip data. */
export function CurveLine({
  dataKey,
  stroke,
  type = "monotone",
  activeDot = false,
  connectNulls = true,
  dot = false,
  filter,
  strokeDasharray,
  strokeWidth = 2.4,
  name,
}: CurveLineProps) {
  return (
    <Line
      activeDot={
        activeDot
          ? {
              r: 5,
              fill: "var(--surface)",
              stroke,
              strokeWidth: 2.5,
            }
          : false
      }
      connectNulls={connectNulls}
      dataKey={dataKey}
      dot={dot}
      filter={filter}
      animationDuration={TREND_CHART_ANIMATION_DURATION}
      animationEasing="ease-out"
      isAnimationActive={false}
      name={name}
      stroke={stroke}
      strokeDasharray={strokeDasharray}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      type={type}
    />
  );
}

export function TrendEffects({ dotsId, glowId }: { dotsId: string; glowId: string }) {
  const plotArea = usePlotArea();
  return (
    <defs>
      {plotArea ? <TrendDotPattern height={plotArea.height} id={dotsId} top={plotArea.y} /> : null}
      {plotArea ? (
        <filter
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse"
          height={plotArea.height + 48}
          id={glowId}
          width={plotArea.width + 48}
          x={plotArea.x - 24}
          y={plotArea.y - 24}
        >
          <feGaussianBlur in="SourceGraphic" stdDeviation="6" />
          <feComponentTransfer result="wideGlow">
            <feFuncA slope="0.24" type="linear" />
          </feComponentTransfer>
          <feGaussianBlur in="SourceGraphic" result="nearGlow" stdDeviation="2" />
          <feComponentTransfer in="nearGlow" result="softGlow">
            <feFuncA slope="0.4" type="linear" />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode in="wideGlow" />
            <feMergeNode in="softGlow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      ) : null}
    </defs>
  );
}

export function TrendExtentLabels({
  minimum,
  maximum,
  isSensitiveHidden,
}: {
  minimum: string;
  maximum: string;
  isSensitiveHidden: boolean;
}) {
  const plotArea = usePlotArea();
  if (!plotArea) return null;
  return (
    <g
      className="asset-trend-extent-labels"
      fill="var(--secondary)"
      fontFamily="var(--f-display)"
      fontSize={12}
      fontWeight={500}
    >
      <text x={plotArea.x} y={plotArea.y - 12}>
        {isSensitiveHidden ? "••••••" : maximum}
      </text>
      {minimum !== maximum ? (
        <text x={plotArea.x} y={plotArea.y + plotArea.height + 20}>
          {isSensitiveHidden ? "••••••" : minimum}
        </text>
      ) : null}
    </g>
  );
}
