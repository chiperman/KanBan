"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import {
  decimalCompare,
  decimalSubtract,
  decimalToFixed,
} from "@/domain/decimal";
import {
  buildTotalValuation,
  type DistributionDimension,
  type ReportingCurrency,
  type ValuationSource,
} from "@/domain/valuation";
import type { DailyAssetSnapshot } from "@/server/ports";
import {
  VibeMetric,
  VibeSegmentedBar,
  VibeStatusTag,
} from "@/ui/vibe/vibe-data-instrument";

type InstrumentOption<Value extends string> = {
  value: Value;
  label: string;
};

const CURRENCY_OPTIONS: readonly InstrumentOption<ReportingCurrency>[] = [
  { value: "USD", label: "USD" },
  { value: "CNY", label: "CNY" },
];

const DIMENSION_OPTIONS: readonly InstrumentOption<DistributionDimension>[] = [
  { value: "class", label: "证券 / 加密资产" },
  { value: "source", label: "资产来源" },
  { value: "currency", label: "原始币种" },
];

function sourceGroupTitle(source: ValuationSource): string {
  if (source.kind === "longbridge") return "长桥账户";
  return source.label;
}

function InstrumentSelect<Value extends string>({
  label,
  value,
  options,
  wide = false,
  onChange,
}: {
  label: string;
  value: Value;
  options: readonly InstrumentOption<Value>[];
  wide?: boolean;
  onChange(value: Value): void;
}) {
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedOptionRef = useRef<HTMLButtonElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (open) selectedOptionRef.current?.focus();
  }, [open]);

  function closeAndFocusTrigger() {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function chooseOption(nextValue: Value) {
    if (nextValue !== value) onChange(nextValue);
    closeAndFocusTrigger();
  }

  function moveOptionFocus(
    event: KeyboardEvent<HTMLButtonElement>,
    destination: "next" | "previous" | "first" | "last",
  ) {
    const optionElements = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
    );
    if (optionElements.length === 0) return;
    const currentIndex = optionElements.indexOf(event.currentTarget);
    const nextIndex =
      destination === "first"
        ? 0
        : destination === "last"
          ? optionElements.length - 1
          : destination === "next"
            ? (currentIndex + 1) % optionElements.length
            : (currentIndex - 1 + optionElements.length) % optionElements.length;
    event.preventDefault();
    optionElements[nextIndex]?.focus();
  }

  return (
    <div
      ref={rootRef}
      className={`instrument-select${wide ? " instrument-select-wide" : ""}`}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
          setOpen(false);
        }
      }}
    >
      <span id={labelId} className="instrument-select-label">
        {label}
      </span>
      <button
        ref={triggerRef}
        type="button"
        className="instrument-select-trigger"
        aria-labelledby={labelId}
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            setOpen(false);
          }
        }}
      >
        <span>{selected.label}</span>
        <span className="instrument-select-chevron" aria-hidden="true" />
      </button>
      {open ? (
        <div
          id={menuId}
          className="instrument-select-menu"
          role="listbox"
          aria-labelledby={labelId}
        >
          {options.map((option) => (
            <button
              key={option.value}
              ref={option.value === value ? selectedOptionRef : undefined}
              type="button"
              role="option"
              className="instrument-select-option"
              aria-selected={option.value === value}
              onClick={() => chooseOption(option.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") moveOptionFocus(event, "next");
                else if (event.key === "ArrowUp") moveOptionFocus(event, "previous");
                else if (event.key === "Home") moveOptionFocus(event, "first");
                else if (event.key === "End") moveOptionFocus(event, "last");
                else if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  chooseOption(option.value);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  closeAndFocusTrigger();
                }
              }}
            >
              <span>{option.label}</span>
              {option.value === value ? (
                <span className="instrument-select-check" aria-hidden="true">
                  ✓
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function amount(value: string): string {
  const [integer, fraction] = decimalToFixed(value, 2).split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped}.${fraction}`;
}

function dayLabel(day: string): string {
  return `${day.slice(5, 7)}月${day.slice(8, 10)}日`;
}

function signedAmount(value: string): string {
  return `${decimalCompare(value, "0") >= 0 ? "+" : ""}${amount(value)}`;
}

export function TotalAssetOverview({
  sources,
  history,
  currentDay,
  showSensitiveInfo,
}: {
  sources: ValuationSource[];
  history: DailyAssetSnapshot[];
  currentDay: string;
  showSensitiveInfo: boolean;
}) {
  const [currency, setCurrency] = useState<ReportingCurrency>("USD");
  const [dimension, setDimension] = useState<DistributionDimension>("class");

  useEffect(() => {
    const savedCurrency = window.localStorage.getItem("reporting-currency");
    if (savedCurrency === "USD" || savedCurrency === "CNY") {
      setCurrency(savedCurrency);
    }
    const savedDimension = window.localStorage.getItem("distribution-dimension");
    if (
      savedDimension === "class" ||
      savedDimension === "source" ||
      savedDimension === "currency"
    ) {
      setDimension(savedDimension);
    }
  }, []);

  const valuation = useMemo(
    () => buildTotalValuation(sources, currency, dimension),
    [currency, dimension, sources],
  );
  const todayBaseline = history.find((snapshot) => snapshot.day === currentDay);
  const baselineAmount = todayBaseline?.total[currency] ?? null;
  const todayChange =
    valuation.amount === null || baselineAmount === null
      ? null
      : decimalSubtract(valuation.amount, baselineAmount);
  const changeIncomplete =
    valuation.incomplete ||
    valuation.expiredCount > 0 ||
    todayBaseline?.complete === false;
  const todayChangeStatus =
    todayBaseline?.complete === false
      ? "今日变动：基准不完整"
      : valuation.incomplete
        ? "今日变动：当前估值不完整"
        : valuation.expiredCount > 0
          ? "今日变动：包含过期来源"
          : null;
  const allocationGroups = valuation.groups.filter(
    (group) => group.amount !== null && decimalCompare(group.amount, "0") > 0,
  );
  const sourceTitleById = new Map(
    sources.map((source) => [source.id, sourceGroupTitle(source)]),
  );
  const valuationStatus = [
    valuation.incomplete
      ? `当前估值：不完整 · ${valuation.unvaluedCount} 项未估值`
      : "当前估值：完整",
    valuation.expiredCount > 0
      ? `包含 ${valuation.expiredCount} 个过期来源`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  function changeCurrency(value: ReportingCurrency) {
    setCurrency(value);
    window.localStorage.setItem("reporting-currency", value);
  }

  function changeDimension(value: DistributionDimension) {
    setDimension(value);
    window.localStorage.setItem("distribution-dimension", value);
  }

  return (
    <section
      className="total-overview vibe-data-module"
      data-testid="total-asset-overview"
      data-vibe-module="asset-overview"
    >
      <div className="total-overview-head">
        <div>
          <p className="card-label">总资产概览</p>
          <VibeMetric
            className="total-overview-amount"
            data-testid="total-asset-amount"
            unit={valuation.currency}
            value={valuation.amount === null
              ? "无法折算"
              : showSensitiveInfo
                ? amount(valuation.amount)
                : "••••••"}
          />
          <VibeStatusTag
            className={`total-status${valuation.incomplete ? " incomplete" : ""}${valuation.expiredCount > 0 ? " expired" : ""}`}
            tone={valuation.incomplete || valuation.expiredCount > 0 ? "warning" : "muted"}
          >
            {valuationStatus}
          </VibeStatusTag>
          <div className="allocation-instrument" aria-label="分配比例仪表">
            <div className="allocation-instrument-head">
              <span>ALLOCATION / {dimension.toUpperCase()}</span>
              <span>{String(allocationGroups.length).padStart(2, "0")} GROUPS</span>
            </div>
            <VibeSegmentedBar
              ariaLabel={`${dimension} 维度资产分配，共 ${allocationGroups.length} 组`}
              segments={allocationGroups.map((group) => ({
                key: group.key,
                value: Number(group.amount),
              }))}
            />
          </div>
        </div>
        <div className="valuation-controls">
          <InstrumentSelect
            label="计价货币"
            value={currency}
            options={CURRENCY_OPTIONS}
            onChange={changeCurrency}
          />
          <InstrumentSelect
            label="分布维度"
            value={dimension}
            options={DIMENSION_OPTIONS}
            wide
            onChange={changeDimension}
          />
        </div>
      </div>
      {valuation.conversion ? (
        <p className="conversion-observation">
          汇率观察：{valuation.conversion.baseCurrency}/{valuation.conversion.quoteCurrency}{" "}
          {decimalToFixed(valuation.conversion.rate, 4)} · {valuation.conversion.source} · {valuation.conversion.observedAt.slice(0, 16).replace("T", " ")} UTC
        </p>
      ) : null}
      <section className="today-asset-change" data-testid="today-asset-change">
        <p className="card-label">今日资产变动</p>
        {todayChange === null ? (
          <p className="trend-empty">
            {todayBaseline
              ? "当前值或今日基准无法可靠折算"
              : "首次成功同步后建立今日基准"}
          </p>
        ) : (
          <p className="today-change-amount">
            {showSensitiveInfo ? signedAmount(todayChange) : "••••••"}{" "}
            <span className="amount-unit">{currency}</span>
            {changeIncomplete && todayChangeStatus ? (
              <span className="today-change-note"> · {todayChangeStatus}</span>
            ) : null}
          </p>
        )}
      </section>
      <div className="distribution-list" aria-label="资产分布">
        {valuation.groups.map((group, index) => (
          <div key={group.key} className="distribution-item vibe-data-row">
            <span className="distribution-name">
              <span className="distribution-index">
                {String(index + 1).padStart(2, "0")}
              </span>
              {dimension === "source"
                ? (sourceTitleById.get(group.key) ?? group.label)
                : group.label}
            </span>
            <strong>
              {group.amount === null
                ? "未折算"
                : showSensitiveInfo
                  ? amount(group.amount)
                  : "••••••"}{" "}
              {valuation.currency}
            </strong>
          </div>
        ))}
      </div>
      <section className="asset-trend" data-testid="total-asset-trend">
        <p className="card-label">总资产趋势</p>
        {history.length === 0 ? (
          <p className="trend-empty">首次成功同步后开始记录</p>
        ) : (
          <ol className="trend-list">
            {history.map((snapshot) => (
              <li key={snapshot.day}>
                <time dateTime={snapshot.day}>{dayLabel(snapshot.day)}</time>
                <strong>
                  {snapshot.total[currency] === null
                    ? "未估值"
                    : `${showSensitiveInfo ? amount(snapshot.total[currency]) : "••••••"} ${currency}`}
                </strong>
                <span>
                  {snapshot.complete && snapshot.total[currency] !== null
                    ? "历史快照：完整"
                    : "历史快照：不完整"}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}
