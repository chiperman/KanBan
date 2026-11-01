import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  YAxis,
} from "recharts";

import { FundingEventLegend, FundingEventMarker } from "./funding-events";
import { CurveLine, TrendEffects, TrendExtentLabels } from "./plot-parts";
import type { ChartDatum, ResolvedChartProps } from "./shared";
import {
  FUNDING_EVENT_Z_INDEX,
  TREND_CHART_ANIMATION_DURATION,
  TREND_CHART_AXIS_INSET,
} from "./shared";
import {
  TrendChartSurface,
  TrendChartTooltip,
  TrendTooltip,
  trendTooltipRows,
  trendTooltipSizing,
} from "./tooltip";

import type { PlotFrameProps } from "./shared";

export function renderValuePlot({
  ariaLabel,
  currency,
  formatAmount,
  isSensitiveHidden,
  historicalSeries,
  emptyMessage,
  points,
  showCurrency,
  showDotFill,
  lineType,
  variant,
  chartHeight,
  dateAxis,
  benchmarkLegend,
  dotFillId,
  glowId,
  minimalPlot,
}: Omit<ResolvedChartProps, "formatDay" | "plotPresentation" | "dateAxisPresentation"> &
  PlotFrameProps & { minimalPlot: boolean }) {
  const historicalByDay = new Map(
    historicalSeries?.points.map((point) => [point.day, point]) ?? [],
  );
  const data: ChartDatum[] = points.map((point) => {
    const historicalPoint = historicalByDay.get(point.day);
    return {
      ...point,
      historicalAmount: historicalPoint?.amount ?? null,
      historicalLabel:
        historicalPoint?.amount === null || historicalPoint === undefined
          ? null
          : (historicalSeries?.label ?? null),
      historicalValue:
        historicalPoint?.amount === null || historicalPoint === undefined
          ? null
          : Number(historicalPoint.amount),
      value: point.amount === null ? null : Number(point.amount),
    };
  });
  const historicalObserved = data.filter((point) => point.historicalValue !== null).length;
  const eventPoints = data.filter(
    (point) => point.value !== null && (point.events?.length ?? 0) > 0,
  );
  const today = data.at(-1);
  const amounts = data.flatMap((point) => [
    ...(point.amount === null ? [] : [point.amount]),
    ...(point.historicalAmount === null ? [] : [point.historicalAmount]),
  ]);
  const values = amounts.map(Number);
  if (values.length === 0) {
    return (
      <div className={`asset-trend-comparison asset-trend-comparison--${variant}`}>
        <p className="trend-empty">{emptyMessage}</p>
      </div>
    );
  }

  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const padding =
    maximum === minimum ? Math.max(Math.abs(maximum) * 0.1, 1) : (maximum - minimum) * 0.08;
  const axisMinimum = minimum - padding;
  const axisMaximum = maximum + padding;
  const axisValue = (value: number) =>
    isSensitiveHidden
      ? "••••••"
      : currency === "%"
        ? `${formatAmount(String(value))}%`
        : formatAmount(String(value));
  const lastValueIndex = data.reduce(
    (lastIndex, point, index) => (point.value === null ? lastIndex : index),
    -1,
  );
  const tooltipRows = (point: ChartDatum) =>
    trendTooltipRows(point, { currency, formatAmount, isSensitiveHidden, showCurrency });
  const tooltipSizing = trendTooltipSizing(data.map(tooltipRows));

  return (
    <div className={`asset-trend-comparison asset-trend-comparison--${variant}`}>
      {benchmarkLegend}
      <TrendChartSurface>
        <ResponsiveContainer
          width="100%"
          height={chartHeight ?? (variant === "source" ? 168 : 300)}
        >
          <ComposedChart
            accessibilityLayer
            aria-label={ariaLabel}
            data={data}
            margin={{
              top: minimalPlot ? 32 : 12,
              right: minimalPlot ? 8 : variant === "source" ? 12 : 20,
              bottom: minimalPlot ? 32 : 6,
              left: minimalPlot ? 0 : TREND_CHART_AXIS_INSET,
            }}
            role="img"
          >
            <TrendEffects dotsId={dotFillId} glowId={glowId} />
            {minimalPlot ? null : (
              <CartesianGrid horizontal vertical={false} stroke="var(--line)" strokeDasharray="0" />
            )}
            {dateAxis}
            <YAxis
              axisLine={false}
              domain={[axisMinimum, axisMaximum]}
              hide={minimalPlot}
              tick={{
                className: "asset-trend-axis-tick",
                fill: "var(--muted)",
                fontFamily: "var(--f-display)",
                fontSize: 12,
                fontWeight: 500,
              }}
              tickFormatter={axisValue}
              tickLine={false}
              width={minimalPlot ? 0 : "auto"}
            />
            <TrendChartTooltip
              content={(props) => (
                <TrendTooltip {...props} rowsForPoint={tooltipRows} sizing={tooltipSizing} />
              )}
            />
            {!minimalPlot && today?.amount != null ? (
              <ReferenceLine stroke="var(--secondary)" strokeWidth={1} x={today.day} />
            ) : null}
            {!minimalPlot
              ? eventPoints.map((point) => (
                  <ReferenceDot
                    key={`funding-event:${point.day}`}
                    shape={({ cx, cy }) => (
                      <FundingEventMarker
                        cx={cx}
                        cy={cy}
                        kinds={point.events!.map((event) => event.kind)}
                      />
                    )}
                    x={point.day}
                    y={point.value!}
                    zIndex={FUNDING_EVENT_Z_INDEX}
                  />
                ))
              : null}
            {historicalObserved > 0 ? (
              <CurveLine
                dot={historicalObserved === 1}
                dataKey="historicalValue"
                name={historicalSeries?.label}
                stroke="var(--secondary)"
                strokeDasharray="5 4"
                type={lineType}
              />
            ) : null}
            {showDotFill ? (
              <Area
                activeDot={false}
                baseValue={axisMinimum}
                connectNulls
                dataKey="value"
                dot={false}
                fill={`url(#${dotFillId})`}
                fillOpacity={1}
                animationDuration={TREND_CHART_ANIMATION_DURATION}
                animationEasing="ease-out"
                isAnimationActive={false}
                stroke="none"
                type={lineType}
              />
            ) : null}
            <CurveLine
              activeDot
              dataKey="value"
              filter={`url(#${glowId})`}
              stroke="var(--display)"
              strokeWidth={minimalPlot ? 3 : 2.4}
              type={lineType}
            />
            {minimalPlot ? (
              <TrendExtentLabels
                isSensitiveHidden={isSensitiveHidden}
                maximum={formatAmount(amounts[values.indexOf(maximum)])}
                minimum={formatAmount(amounts[values.indexOf(minimum)])}
              />
            ) : null}
            {lastValueIndex >= 0 && (minimalPlot || !data[lastValueIndex].events?.length) ? (
              <ReferenceDot
                fill="var(--surface)"
                r={5}
                stroke="var(--display)"
                strokeWidth={2.4}
                x={data[lastValueIndex].day}
                y={data[lastValueIndex].value!}
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </TrendChartSurface>
      {!minimalPlot ? <FundingEventLegend points={eventPoints} /> : null}
    </div>
  );
}
