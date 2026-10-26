import type { AssetTrendChartPoint, AssetTrendEvent } from "./shared";

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
