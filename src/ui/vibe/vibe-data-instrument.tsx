import type { HTMLAttributes, ReactNode } from "react";

export interface VibeBarSegment {
  key: string;
  tone?: "muted" | "primary" | "signal";
  value: number;
}

interface VibeSegmentedBarProps {
  ariaLabel: string;
  cells?: number;
  segments: readonly VibeBarSegment[];
  total?: number;
}

function segmentCells(
  segments: readonly VibeBarSegment[],
  total: number,
  cells: number,
) {
  const safeSegments = segments.map((segment) => ({
    ...segment,
    value: Number.isFinite(segment.value) ? Math.max(0, segment.value) : 0,
  }));
  const safeTotal = Number.isFinite(total) ? Math.max(0, total) : 0;

  return Array.from({ length: cells }, (_, index) => {
    if (safeTotal === 0) return null;
    const position = ((index + 0.5) / cells) * safeTotal;
    let cumulative = 0;
    for (const [segmentIndex, segment] of safeSegments.entries()) {
      cumulative += segment.value;
      if (position <= cumulative) return { ...segment, segmentIndex };
    }
    return null;
  });
}

export function VibeSegmentedBar({
  ariaLabel,
  cells = 12,
  segments,
  total = segments.reduce((sum, segment) => sum + segment.value, 0),
}: VibeSegmentedBarProps) {
  const renderedCells = segmentCells(segments, total, cells);

  return (
    <div
      aria-label={ariaLabel}
      className="vibe-segmented-bar"
      data-vibe-component="segmented-bar"
      role="img"
    >
      {renderedCells.map((segment, index) => (
        <span
          className={
            segment
              ? `is-filled is-${segment.tone ?? "primary"} is-group-${(segment.segmentIndex % 3) + 1}`
              : undefined
          }
          data-segment-key={segment?.key}
          key={`${segment?.key ?? "empty"}-${index}`}
        />
      ))}
    </div>
  );
}

interface VibeMetricProps extends HTMLAttributes<HTMLDivElement> {
  unit: string;
  value: string;
}

export function VibeMetric({
  className,
  unit,
  value,
  ...props
}: VibeMetricProps) {
  return (
    <div
      className={["vibe-metric", className].filter(Boolean).join(" ")}
      data-vibe-component="metric"
      {...props}
    >
      <span className="vibe-metric__value">{value}</span>{" "}
      <span className="vibe-metric__unit">{unit}</span>
    </div>
  );
}

type VibeStatusTone = "live" | "muted" | "signal" | "warning" | "error";

interface VibeStatusTagProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  tone?: VibeStatusTone;
}

export function VibeStatusTag({
  children,
  className,
  tone = "muted",
  ...props
}: VibeStatusTagProps) {
  return (
    <span
      className={["vibe-status-tag", `vibe-status-tag--${tone}`, className]
        .filter(Boolean)
        .join(" ")}
      data-vibe-component="status-tag"
      data-vibe-tone={tone}
      {...props}
    >
      <i aria-hidden="true" />
      {children}
    </span>
  );
}
