"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

export type AssetTrendChartPoint = {
  amount: string | null;
  day: string;
  observed: boolean;
  status: "complete" | "incomplete" | "expired";
};

type ChartDatum = AssetTrendChartPoint & {
  value: number | null;
};

function HiddenTrendState({
  variant,
}: {
  variant: "source" | "total";
}) {
  return (
    <div
      className={`asset-trend-private asset-trend-private--${variant}`}
      role="status"
    >
      <div className="asset-trend-private-copy">
        <p>趋势已隐藏</p>
        <strong aria-hidden="true">••••••</strong>
        <span>开启“显示关键信息”以查看趋势与明细</span>
      </div>
    </div>
  );
}

function TrendTooltip({
  active,
  currency,
  formatAmount,
  formatDay,
  payload,
  showCurrency,
}: TooltipContentProps & {
  currency: string;
  formatAmount(value: string): string;
  formatDay(day: string): string;
  showCurrency: boolean;
}) {
  const point = payload?.[0]?.payload as ChartDatum | undefined;
  if (!active || !point) return null;
  const quality = point.amount === null
    ? `未估值 · ${point.status === "expired" ? "过期" : "不完整"}`
    : point.status === "expired"
      ? "过期"
      : point.status === "incomplete"
        ? "不完整"
        : null;

  return (
    <div className="asset-trend-tooltip">
      <span>{formatDay(point.day)}</span>
      <strong>
        {point.amount === null
          ? "未估值"
          : `${formatAmount(point.amount)}${showCurrency ? ` ${currency}` : ""}`}
      </strong>
      {quality ? <small>{quality}</small> : null}
    </div>
  );
}

function QualitySummary({
  incompleteCount,
  observed,
  total,
  unavailableCount,
}: {
  incompleteCount: number;
  observed: number;
  total: number;
  unavailableCount: number;
}) {
  return (
    <p className="asset-trend-quality">
      可绘制 {observed} / {total} 天
      {incompleteCount > 0 ? ` · ${incompleteCount} 天不完整或过期` : ""}
      {unavailableCount > 0 ? ` · ${unavailableCount} 天未估值` : ""}
    </p>
  );
}

export function AssetTrendChart({
  ariaLabel,
  currency,
  formatAmount,
  formatDay,
  incompleteCount,
  isSensitiveHidden = false,
  points,
  showCurrency = true,
  unavailableCount,
  variant = "total",
}: {
  ariaLabel: string;
  currency: string;
  formatAmount(value: string): string;
  formatDay(day: string): string;
  incompleteCount: number;
  isSensitiveHidden?: boolean;
  points: AssetTrendChartPoint[];
  showCurrency?: boolean;
  unavailableCount: number;
  variant?: "source" | "total";
}) {
  if (isSensitiveHidden) {
    return <HiddenTrendState variant={variant} />;
  }

  const data: ChartDatum[] = points.map((point) => ({
    ...point,
    value: point.amount === null ? null : Number(point.amount),
  }));
  const observed = data.filter((point) => point.amount !== null).length;
  const today = data.at(-1);
  const yesterday = data.at(-2);
  let yesterdayChange: number | null = null;
  if (
    today?.amount != null &&
    yesterday?.amount != null &&
    today.status === "complete" &&
    yesterday.status === "complete" &&
    today.value !== null &&
    yesterday.value !== null
  ) {
    yesterdayChange = today.value - yesterday.value;
  }
  const comparisonIssue = (point: ChartDatum | undefined, fallback: string) => {
    if (!point?.observed) return `${fallback}缺少观测`;
    if (point.amount === null) return `${formatDay(point.day)}未估值`;
    if (point.status === "expired") return `${formatDay(point.day)}过期`;
    if (point.status === "incomplete") return `${formatDay(point.day)}不完整`;
    return null;
  };
  const yesterdayComparisonReason = yesterdayChange === null
    ? [
      comparisonIssue(today, "今日"),
      comparisonIssue(yesterday, "昨日"),
    ].filter((reason): reason is string => reason !== null).join("；") ||
      "昨日缺少观测"
    : null;
  const values = data.flatMap((point) => point.value === null ? [] : [point.value]);
  const comparisonHeader = variant === "total" ? (
    <header className="asset-trend-comparison-header">
      <QualitySummary
        incompleteCount={incompleteCount}
        observed={observed}
        total={points.length}
        unavailableCount={unavailableCount}
      />
      <div className="asset-trend-yesterday">
        <span>
          较昨日{yesterday ? ` · ${formatDay(yesterday.day)}` : ""}
        </span>
        <strong
          className={yesterdayChange === null
            ? "asset-trend-yesterday-unavailable"
            : undefined}
        >
          {yesterdayChange === null
            ? "昨日变化未计算"
            : `${yesterdayChange >= 0 ? "+" : ""}${formatAmount(String(yesterdayChange))} ${currency}`}
        </strong>
        <small>{yesterdayChange === null
          ? yesterdayComparisonReason
          : `昨日总资产 ${formatAmount(yesterday?.amount ?? "0")} ${currency}`}
        </small>
      </div>
    </header>
  ) : null;

  if (values.length === 0) {
    return (
      <div className={`asset-trend-comparison asset-trend-comparison--${variant}`}>
        {comparisonHeader}
        <p className="trend-empty">当前计价货币没有可用趋势金额</p>
      </div>
    );
  }

  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const padding = maximum === minimum
    ? Math.max(Math.abs(maximum) * 0.1, 1)
    : (maximum - minimum) * 0.08;
  const axisMinimum = minimum - padding;
  const axisMaximum = maximum + padding;
  const compactAxisValue = (value: number) =>
    Math.abs(value) >= 1_000
      ? `${Math.round(value / 1_000)}k`
      : Math.round(value).toLocaleString();

  return (
    <div className={`asset-trend-comparison asset-trend-comparison--${variant}`}>
      {comparisonHeader}
      <div className="total-trend-chart-wrap">
        <ResponsiveContainer
          width="100%"
          height={variant === "source" ? 168 : 300}
        >
          <LineChart
            accessibilityLayer
            aria-label={ariaLabel}
            data={data}
            margin={{
              top: 12,
              right: variant === "source" ? 12 : 20,
              bottom: 6,
              left: 0,
            }}
            role="img"
          >
            <CartesianGrid
              horizontal
              vertical={false}
              stroke="var(--line)"
              strokeDasharray="0"
            />
            <XAxis
              axisLine={{ stroke: "var(--line-2)" }}
              dataKey="day"
              minTickGap={40}
              tick={{
                fill: "var(--muted)",
                fontFamily: "var(--f-mono)",
                fontSize: 10,
              }}
              tickFormatter={formatDay}
              tickLine={{ stroke: "var(--line-2)" }}
            />
            <YAxis
              axisLine={false}
              domain={[axisMinimum, axisMaximum]}
              tick={{
                fill: "var(--muted)",
                fontFamily: "var(--f-mono)",
                fontSize: 10,
              }}
              tickFormatter={compactAxisValue}
              tickLine={false}
              width={variant === "source" ? 48 : 56}
            />
            <Tooltip
              content={(props) => (
                <TrendTooltip
                  {...props}
                  currency={currency}
                  formatAmount={formatAmount}
                  formatDay={formatDay}
                  showCurrency={showCurrency}
                />
              )}
              cursor={{ stroke: "var(--line-2)", strokeWidth: 1 }}
            />
            {today?.amount != null ? (
              <ReferenceLine
                stroke="var(--secondary)"
                strokeWidth={1}
                x={today.day}
              />
            ) : null}
            <Line
              activeDot={false}
              connectNulls={false}
              dataKey="value"
              dot={false}
              isAnimationActive={false}
              stroke="var(--display)"
              strokeLinecap="square"
              strokeWidth={2}
              type="linear"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
