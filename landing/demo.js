// Public, fixed examples only. This module never connects to an account,
// reads browser storage, or calls the KanBan backend.
const rates = { USD: 1, CNY: 7.2, HKD: 7.78 };
const books = {
  us: {
    name: "美股",
    currency: "USD",
    total: 124820.1,
    investment: 96000,
    records: [80000, 16000],
  },
  cn: {
    name: "A 股",
    currency: "CNY",
    total: 531204.18,
    investment: 420000,
    records: [350000, 70000],
  },
  crypto: {
    name: "虚拟货币",
    currency: "USD",
    total: 50031.96,
    investment: 37400,
    records: [30000, 7400],
  },
};
const total =
  Math.round(
    (books.us.total + books.cn.total / rates.CNY + books.crypto.total) * 100,
  ) / 100;
const dates = Array.from({ length: 91 }, (_, index) =>
  new Date(Date.UTC(2026, 7, 7 + index)).toISOString().slice(0, 10),
);
// All demo views share these fictional valuations and the same two funding
// records. No account state or application financial engine runs on this page.
for (const [bookIndex, book] of Object.values(books).entries()) {
  book.observations = dates.map((date, index) => {
    const progress = index / (dates.length - 1);
    const growth =
      progress +
      Math.sin(index * 0.26 + bookIndex) * progress * (1 - progress) * 0.3;
    return {
      date,
      value:
        Math.round(
          (book.records[0] +
            (date >= "2026-09-18" ? book.records[1] : 0) +
            (book.total - book.investment) * growth) *
            100,
        ) / 100,
    };
  });
}
// Keep the illustrated daily change consistent with the latest two totals.
books.us.observations.at(-2).value =
  Math.round(
    (total -
      1284.6 -
      books.cn.observations.at(-2).value / rates.CNY -
      books.crypto.observations.at(-2).value) *
      100,
  ) / 100;
const observations = dates.map((date, index) => ({
  date,
  value:
    Math.round(
      Object.values(books).reduce(
        (sum, book) =>
          sum + book.observations[index].value / rates[book.currency],
        0,
      ) * 100,
    ) / 100,
}));
const inRange = (series, range) =>
  range === "all" ? series : series.slice(-Number(range));

// Modified Dietz for the fixed example only, matching the product's funding
// boundary: start-day flows are already in the start valuation.
function bookPerformance(book, start, end, cumulative) {
  const opening = book.records[0];
  const deposit = book.records[1];
  const depositDay = "2026-09-18";
  const startDay = cumulative ? dates[0] : start.date;
  const startValue = cumulative ? opening : start.value;
  const flow = depositDay > startDay && depositDay <= end.date ? deposit : 0;
  const span = Date.parse(end.date) - Date.parse(startDay);
  const profit = end.value - startValue - flow;
  const denominator =
    startValue +
    (flow * (Date.parse(end.date) - Date.parse(depositDay))) / (span || 1);
  return {
    total: end.value,
    investment: cumulative ? opening + flow : flow,
    profit,
    return: span === 0 ? 0 : (profit / denominator) * 100,
  };
}
const dayLabel = (date) => date.slice(5).replace("-", ".");
const number = (value, signed = false) => {
  const formatted = Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${value < 0 ? "−" : signed ? "+" : ""}${formatted}`;
};

// Steffen monotone interpolation, matching Recharts' monotoneX curve.
// It passes through every observation without introducing artificial extrema.
function curve(points) {
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;
  if (points.length === 2)
    return `M${points[0].x},${points[0].y}L${points[1].x},${points[1].y}`;
  const slopes = points
    .slice(1)
    .map(
      (point, index) =>
        (point.y - points[index].y) / (point.x - points[index].x),
    );
  const tangents = points.map((point, index) => {
    if (index === 0 || index === points.length - 1) return 0;
    const before = slopes[index - 1],
      after = slopes[index];
    const left = point.x - points[index - 1].x,
      right = points[index + 1].x - point.x;
    const weighted = (before * right + after * left) / (left + right);
    return (
      (Math.sign(before) + Math.sign(after)) *
      Math.min(Math.abs(before), Math.abs(after), Math.abs(weighted) / 2)
    );
  });
  tangents[0] = (3 * slopes[0] - tangents[1]) / 2;
  tangents[points.length - 1] = (3 * slopes.at(-1) - tangents.at(-2)) / 2;
  return points.reduce((path, point, index) => {
    if (index === 0) return `M${point.x},${point.y}`;
    const prior = points[index - 1],
      width = (point.x - prior.x) / 3;
    return `${path}C${prior.x + width},${prior.y + tangents[index - 1] * width} ${point.x - width},${point.y - tangents[index] * width} ${point.x},${point.y}`;
  }, "");
}

// Same calendar cadence as src/ui/asset-trend/date-axis.tsx.
function calendarTicks(days, width) {
  const span = (Date.parse(days.at(-1)) - Date.parse(days[0])) / 86400000;
  const monthly = span > 62,
    gap = monthly ? 44 : 56;
  const position = (index) =>
    days.length === 1 ? width / 2 : (index / (days.length - 1)) * width;
  const candidates = (step) =>
    days.flatMap((day, index) => {
      if (index === 0) return [{ day, index }];
      if (monthly)
        return day.slice(0, 7) !== days[index - 1].slice(0, 7) &&
          (Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1) %
            step ===
            0
          ? [{ day, index }]
          : [];
      return index % step === 0 ||
        day.endsWith("-01-01") ||
        index === days.length - 1
        ? [{ day, index }]
        : [];
    });
  const steps = monthly
    ? [1, 2, 3, 6, 12, 24, 60, 120]
    : [1, 2, 3, 7, 14, 28, 56];
  const step =
    steps.find((value) =>
      !monthly
        ? (span / value) * gap <= width
        : candidates(value)
            .slice(2)
            .every(
              (tick, index) =>
                position(tick.index) -
                  position(candidates(value)[index + 1].index) >=
                gap,
            ),
    ) ?? steps.at(-1);
  const selected = [];
  for (const tick of candidates(step)) {
    const previous = selected.at(-1);
    if (previous && position(tick.index) - position(previous.index) < gap) {
      if (
        tick.day.slice(0, 4) === previous.day.slice(0, 4) &&
        !(!monthly && tick.day === days.at(-1) && selected.length > 1)
      )
        continue;
      selected.pop();
    }
    selected.push(tick);
  }
  return selected.map(({ day, index }, tickIndex) => ({
    index,
    label: monthly ? `${Number(day.slice(5, 7))}月` : dayLabel(day),
    year:
      tickIndex === 0 ||
      day.slice(0, 4) !== selected[tickIndex - 1].day.slice(0, 4)
        ? day.slice(0, 4)
        : null,
    anchor:
      position(index) < gap / 2
        ? "start"
        : position(index) > width - gap / 2
          ? "end"
          : "middle",
  }));
}

export function initProductDemo() {
  const preview = document.querySelector(".product-preview");
  if (!preview) return null;
  const state = {
    currency: "USD",
    private: false,
    range: "all",
    book: "us",
    bookView: "performance",
    bookRange: "all",
    customRanges: { overview: null, books: null },
    benchmarks: new Set(["spx", "ndx"]),
    bookCurve: "total",
    recordFilter: "funds",
    view: "overview",
  };
  const status = document.querySelector("#demo-status");
  const tabs = [...preview.querySelectorAll("[data-view]")];
  const announce = (message) => {
    status.textContent = message;
  };
  const readMoney = (value, signed = false) =>
    state.private ? "••••••" : number(value, signed);
  const moneyMeasure = document.createElement("canvas").getContext("2d");

  function updateMoney() {
    preview.dataset.private = String(state.private);
    preview.querySelectorAll(".money").forEach((element) => {
      if (element.dataset.unavailable === "true") {
        element.textContent = "数据不足";
        element.style.minInlineSize = "";
        return;
      }
      const value = Number(element.dataset.value);
      const converted =
        value * (element.dataset.native ? 1 : rates[state.currency]);
      const signed = element.hasAttribute("data-signed");
      const style = getComputedStyle(element);
      moneyMeasure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      moneyMeasure.letterSpacing = style.letterSpacing;
      element.style.minInlineSize = `${Math.ceil(moneyMeasure.measureText(number(converted, signed)).width)}px`;
      element.textContent = readMoney(converted, signed);
    });
    preview.querySelectorAll("[data-currency]").forEach((element) => {
      element.textContent = state.currency;
    });
    overviewChart.refresh();
    bookChart.refresh();
  }

  // Static equivalent of asset-trend/{value-plot,plot-parts,tooltip,date-axis}.
  // Draw in CSS pixels so chart text, 8px dots and markers retain product sizes.
  function createChart(chart, presentation) {
    const svg = chart.querySelector("svg");
    const tooltip = chart.querySelector(".chart-tooltip");
    const marker = chart.querySelector(".chart-active");
    const crosshair = chart.querySelector(".chart-crosshair");
    const full = chart.id === "book-chart";
    const namespace = "http://www.w3.org/2000/svg";
    const textMeasure = document.createElement("canvas").getContext("2d");
    const id = chart.id;
    let shown = [];
    let points = [];
    let inspected = null;
    let frame = {
      left: 8,
      right: 492,
      top: 12,
      bottom: 206,
      width: 500,
      height: 256,
    };
    const node = (name, attributes = {}, text) => {
      const element = document.createElementNS(namespace, name);
      for (const [key, value] of Object.entries(attributes))
        element.setAttribute(key, value);
      if (text !== undefined) element.textContent = text;
      return element;
    };
    const measure = (text, font = "Doto") => {
      textMeasure.font = `500 12px "${font}"`;
      return textMeasure.measureText(text).width;
    };
    const rawAxisValue = (value) =>
      `${number(value)}${presentation().unit === "%" ? "%" : ""}`;
    const axisValue = (value) =>
      state.private ? "••••••" : rawAxisValue(value);
    const dateLabel = (date) =>
      `${date.slice(0, 4)} 年 ${date.slice(5, 7)} 月 ${date.slice(8)} 日`;
    function reset() {
      inspected = null;
      tooltip.hidden = true;
      crosshair.setAttribute("hidden", "");
      marker.setAttribute("hidden", "");
    }
    function inspect(index, keyboard = false, pointerX = null) {
      if (!shown.length || chart.hidden) return;
      inspected = Math.max(0, Math.min(shown.length - 1, index));
      const point = points[inspected];
      const observation = shown[inspected];
      const { format, unit } = presentation();
      marker.setAttribute("cx", point.x);
      marker.setAttribute("cy", point.y);
      marker.removeAttribute("hidden");
      const cursor = Math.max(
        frame.left,
        Math.min(frame.right, pointerX ?? point.x),
      );
      crosshair.setAttribute("x1", cursor);
      crosshair.setAttribute("x2", cursor);
      crosshair.removeAttribute("hidden");
      tooltip.querySelector(".tooltip-day").textContent = dateLabel(
        observation.date,
      );
      const value = document.createElement("span");
      value.textContent = format(observation.value);
      const currency = document.createElement("span");
      currency.className = "tooltip-unit";
      currency.textContent = unit;
      tooltip.querySelector(".tooltip-value").replaceChildren(value, currency);
      tooltip
        .querySelectorAll(".tooltip-event")
        .forEach((element) => element.remove());
      for (const event of observation.events ?? []) {
        const row = document.createElement("small");
        row.className = "tooltip-event";
        row.dataset.kind = event.kind;
        const label = document.createElement("span");
        label.textContent = `${event.kind === "opening" ? "期初本金" : "入金"} ${readMoney(event.value, event.kind === "deposit")}`;
        const eventUnit = document.createElement("span");
        eventUnit.textContent = event.currency;
        row.append(label, eventUnit);
        tooltip.append(row);
      }
      tooltip.hidden = false;
      const x =
        point.x + 10 + tooltip.offsetWidth <= frame.width
          ? point.x + 10
          : point.x - tooltip.offsetWidth - 10;
      const y =
        point.y + 10 + tooltip.offsetHeight <= frame.height
          ? point.y + 10
          : point.y - tooltip.offsetHeight - 10;
      tooltip.style.left = `${Math.max(0, Math.min(frame.width - tooltip.offsetWidth, x))}px`;
      tooltip.style.top = `${Math.max(0, y)}px`;
      if (keyboard)
        announce(
          `${observation.date}，虚构示例 ${format(observation.value)} ${unit}`,
        );
    }
    function trackPointer(event) {
      if (!shown.length) return;
      const bounds = svg.getBoundingClientRect();
      const x = ((event.clientX - bounds.left) / bounds.width) * frame.width;
      const y = ((event.clientY - bounds.top) / bounds.height) * frame.height;
      if (
        x < frame.left ||
        x > frame.right ||
        y < frame.top ||
        y > frame.bottom
      )
        return reset();
      inspect(
        Math.round(
          ((x - frame.left) / (frame.right - frame.left)) * (shown.length - 1),
        ),
        false,
        x,
      );
    }
    svg.addEventListener("pointermove", trackPointer);
    svg.addEventListener("pointerdown", trackPointer);
    for (const event of ["pointerleave", "pointercancel", "blur"])
      svg.addEventListener(event, reset);
    svg.addEventListener("keydown", (event) => {
      if (
        !["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(
          event.key,
        )
      )
        return;
      event.preventDefault();
      if (event.key === "Escape") return reset();
      inspect(
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? shown.length - 1
            : (inspected ?? shown.length - 1) +
              (event.key === "ArrowLeft" ? -1 : 1),
        true,
      );
    });
    function draw() {
      const bounds = chart.getBoundingClientRect();
      if (!shown.length || bounds.width === 0) return;
      reset();
      const width = bounds.width;
      const height = bounds.height;
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      const values = shown.map((point) => point.value);
      const minimum = Math.min(...values);
      const maximum = Math.max(...values);
      const padding =
        maximum === minimum
          ? Math.max(Math.abs(maximum) * 0.1, 1)
          : (maximum - minimum) * 0.08;
      const lower = minimum - padding;
      const upper = maximum + padding;
      const rawStep = (upper - lower) / 4;
      const magnitude = 10 ** Math.floor(Math.log10(rawStep));
      const step =
        ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(
          (value) => value * magnitude >= rawStep,
        ) ?? 10) * magnitude;
      const ticks = [lower];
      for (let value = lower + step; value < upper - step * 0.1; value += step)
        ticks.push(value);
      ticks.push(upper);
      const left = full
        ? Math.ceil(
            Math.max(
              measure("••••••"),
              ...ticks.map((value) => measure(rawAxisValue(value))),
            ),
          ) + 16
        : 8;
      frame = {
        left,
        right: width - (full ? 12 : 8),
        top: full ? 12 : 32,
        bottom: height - (full ? 50 : 32),
        width,
        height,
      };
      const plotHeight = frame.bottom - frame.top;
      const plotWidth = frame.right - frame.left;
      const yFor = (value) =>
        frame.bottom - ((value - lower) / (upper - lower)) * plotHeight;
      points = shown.map((point, index) => ({
        x:
          left +
          (shown.length === 1 ? 0.5 : index / (shown.length - 1)) * plotWidth,
        y: yFor(point.value),
      }));
      const pattern = node("pattern", {
        id: `${id}-dots`,
        width: 8,
        height,
        patternUnits: "userSpaceOnUse",
      });
      const rows = Math.ceil(plotHeight / 8);
      for (let row = 0; row < rows; row++)
        pattern.append(
          node("circle", {
            cx: 4,
            cy: frame.top + row * 8 + 4,
            r: 1,
            fill: "var(--display)",
            opacity: 0.72 * (1 - row / rows),
          }),
        );
      const glow = node("filter", {
        id: `${id}-glow`,
        filterUnits: "userSpaceOnUse",
        x: frame.left - 24,
        y: frame.top - 24,
        width: plotWidth + 48,
        height: plotHeight + 48,
        "color-interpolation-filters": "sRGB",
      });
      const wide = node("feComponentTransfer", { result: "wideGlow" });
      wide.append(node("feFuncA", { type: "linear", slope: 0.24 }));
      const near = node("feComponentTransfer", {
        in: "nearGlow",
        result: "softGlow",
      });
      near.append(node("feFuncA", { type: "linear", slope: 0.4 }));
      const merge = node("feMerge");
      for (const input of ["wideGlow", "softGlow", "SourceGraphic"])
        merge.append(node("feMergeNode", { in: input }));
      glow.append(
        node("feGaussianBlur", { in: "SourceGraphic", stdDeviation: 6 }),
        wide,
        node("feGaussianBlur", {
          in: "SourceGraphic",
          result: "nearGlow",
          stdDeviation: 2,
        }),
        near,
        merge,
      );
      svg.querySelector("defs").replaceChildren(pattern, glow);
      const path = curve(points);
      svg.querySelector(".chart-line").setAttribute("d", path);
      svg
        .querySelector(".chart-line")
        .setAttribute("filter", `url(#${id}-glow)`);
      const area = svg.querySelector(".chart-area");
      area.setAttribute("fill", `url(#${id}-dots)`);
      area.setAttribute(
        "d",
        `${path}L${points.at(-1).x},${frame.bottom}H${points[0].x}Z`,
      );
      const last = svg.querySelector(".chart-point");
      last.setAttribute("cx", points.at(-1).x);
      last.setAttribute("cy", points.at(-1).y);
      const latest = svg.querySelector(".chart-latest");
      latest.toggleAttribute("hidden", !full);
      latest.setAttribute("x1", points.at(-1).x);
      latest.setAttribute("x2", points.at(-1).x);
      for (const line of [latest, crosshair]) {
        line.setAttribute("y1", frame.top);
        line.setAttribute("y2", frame.bottom);
      }
      const grid = svg.querySelector(".chart-grid");
      const labels = svg.querySelector(".chart-ticks");
      grid.replaceChildren();
      labels.replaceChildren();
      if (full) {
        for (const value of ticks) {
          const y = yFor(value);
          grid.append(node("path", { d: `M${left},${y}H${frame.right}` }));
          labels.append(
            node(
              "text",
              {
                class: "chart-tick",
                x: left - 8,
                y,
                dy: "0.355em",
                "text-anchor": "end",
              },
              axisValue(value),
            ),
          );
        }
        labels.append(
          node("line", {
            class: "chart-axis-line",
            x1: left,
            x2: frame.right,
            y1: frame.bottom,
            y2: frame.bottom,
          }),
        );
        for (const tick of calendarTicks(
          shown.map((point) => point.date),
          plotWidth,
        )) {
          const x = points[tick.index].x;
          labels.append(
            node("line", {
              class: "chart-axis-line",
              x1: x,
              x2: x,
              y1: frame.bottom,
              y2: frame.bottom + 6,
            }),
          );
          const label = node("text", {
            class: "chart-tick",
            x,
            y: frame.bottom + 8,
            dy: "0.71em",
            "text-anchor": tick.anchor,
          });
          label.append(node("tspan", { x }, tick.label));
          if (tick.year)
            label.append(node("tspan", { x, dy: "1.5em" }, tick.year));
          labels.append(label);
        }
      }
      const funding = svg.querySelector(".chart-funding");
      funding.replaceChildren();
      shown.forEach((observation, index) => {
        for (const event of observation.events ?? []) {
          const point = points[index];
          const radius = event.kind === "opening" ? 2.5 : 4;
          const group = node("g", {
            class: "funding-marker",
            "data-kind": event.kind,
          });
          group.append(
            node("circle", { cx: point.x, cy: point.y, r: radius + 2.5 }),
            node("circle", { cx: point.x, cy: point.y, r: radius }),
          );
          funding.append(group);
        }
      });
      // Size once across every day/event so moving the cursor cannot resize the tip.
      const eventLabels = shown.flatMap((point) =>
        (point.events ?? []).map(
          (event) =>
            `${event.kind === "opening" ? "期初本金" : "入金"} ${readMoney(event.value, event.kind === "deposit")} ${event.currency}`,
        ),
      );
      tooltip.style.minWidth = `${Math.ceil(Math.max(measure(dateLabel(shown[0].date), "Geist Mono") + 19 * 0.96, ...eventLabels.map((text) => measure(text, "Geist Mono") + text.length * 0.96), ...values.map((value) => measure(presentation().format(value)) + measure(presentation().unit, "Geist Mono") + 8))) + 26}px`;
    }
    new ResizeObserver(draw).observe(chart);
    document.fonts.ready.then(draw);
    return {
      reset,
      refresh() {
        const index = inspected;
        draw();
        if (index !== null) inspect(index);
      },
      draw(series) {
        shown = series;
        draw();
      },
    };
  }
  const overviewChart = createChart(
    preview.querySelector("#overview-chart"),
    () => ({
      format: (value) => readMoney(value * rates[state.currency]),
      unit: state.currency,
    }),
  );
  const bookChart = createChart(preview.querySelector("#book-chart"), () => ({
    format: (value) => readMoney(value),
    unit: state.bookCurve === "return" ? "%" : books[state.book].currency,
  }));

  const selectedSeries = (series, scope) => {
    const preset = scope === "books" ? state.bookRange : state.range;
    const range = state.customRanges[scope];
    return preset === "custom" && range
      ? series.filter(
          (point) => point.date >= range.start && point.date <= range.end,
        )
      : inRange(series, preset);
  };
  function drawChart() {
    const shown = selectedSeries(observations, "overview");
    overviewChart.draw(shown);
    preview.querySelector("#chart-first").textContent = dayLabel(shown[0].date);
    preview.querySelector("#chart-middle").textContent = dayLabel(
      shown[Math.floor(shown.length / 2)].date,
    );
    preview.querySelector("#chart-last").textContent = dayLabel(
      shown.at(-1).date,
    );
    preview.querySelector("#chart-period").textContent =
      `${dayLabel(shown[0].date)} — ${dayLabel(shown.at(-1).date)}`;
  }

  function renderBook() {
    const book = books[state.book];
    const shown = selectedSeries(book.observations, "books");
    const cumulative = state.bookRange === "all";
    const metrics = bookPerformance(book, shown[0], shown.at(-1), cumulative);
    const singleDay = !cumulative && shown.length === 1;
    if (singleDay) {
      metrics.profit = null;
      metrics.return = null;
    }
    const labels = cumulative
      ? ["资产总额", "累计净投入", "累计收益", "累计收益率"]
      : ["期末资产", "区间净流入", "区间收益", "区间收益率"];
    preview
      .querySelectorAll("[data-metric-label]")
      .forEach((element, index) => {
        element.textContent = labels[index];
      });
    for (const [key, value] of Object.entries(metrics)) {
      const element = preview.querySelector(`#ledger-${key}`);
      element.dataset.value = value;
      element.dataset.native = key === "return" ? "%" : book.currency;
      element.dataset.unavailable = String(value === null);
      element.classList.toggle("is-unavailable", value === null);
      element.nextElementSibling.hidden = value === null;
    }
    preview.querySelectorAll("[data-book-currency]").forEach((element) => {
      element.textContent = book.currency;
    });
    preview.querySelector("#ledger-summary-title").textContent = cumulative
      ? "累计表现"
      : "区间表现";
    preview.querySelector("#ledger-period").textContent = cumulative
      ? "截至 2026-11-05"
      : `${shown[0].date} 至 ${shown.at(-1).date}`;
    const title =
      state.bookCurve === "total"
        ? "总资产趋势"
        : cumulative
          ? "累计收益率走势"
          : "区间收益率走势";
    preview.querySelector("#book-chart-title").textContent = title;
    const chart = preview.querySelector("#book-chart");
    chart
      .querySelector("svg")
      .setAttribute(
        "aria-label",
        `虚构${book.name}${title}，按左右方向键查看每日数值`,
      );
    chart.hidden = singleDay && state.bookCurve === "return";
    preview.querySelector("#book-chart-events").hidden = !shown.some(
      (point) => point.date === "2026-09-18",
    );
    preview.querySelector("#book-chart-note").hidden = !singleDay;
    preview.querySelector("#book-benchmark").hidden =
      state.bookCurve !== "return";
    bookChart.draw(
      shown.map((point) => ({
        date: point.date,
        events:
          point.date === dates[0]
            ? [
                {
                  kind: "opening",
                  value: book.records[0],
                  currency: book.currency,
                },
              ]
            : point.date === "2026-09-18"
              ? [
                  {
                    kind: "deposit",
                    value: book.records[1],
                    currency: book.currency,
                  },
                ]
              : [],
        value:
          state.bookCurve === "total"
            ? point.value
            : bookPerformance(book, shown[0], point, cumulative).return,
      })),
    );
    preview.querySelector("#benchmark-book").textContent =
      `我的${book.name}收益率`;
    preview.querySelector("#benchmark-state").textContent = state.benchmarks
      .size
      ? `${cumulative ? "累计" : "区间"}收益率　接入长桥行情后可对比。此演示不加载指数行情。`
      : "";
    renderRecords();
    updateMoney();
  }

  function renderRecords() {
    const book = books[state.book];
    const funds = [
      {
        date: dates[0],
        label: "期初本金",
        basis: "手动记录",
        value: book.records[0],
      },
      {
        date: "2026-09-18",
        label: "入金",
        basis: "手动记录",
        value: book.records[1],
      },
    ];
    const valuations = book.observations.slice(-3).map((point) => ({
      ...point,
      label: "资产金额",
      basis: book === books.cn ? "手动资产金额" : "自动汇总",
    }));
    const rows = (
      state.recordFilter === "funds"
        ? funds
        : state.recordFilter === "valuations"
          ? valuations
          : [...funds, ...valuations]
    ).toSorted((a, b) => b.date.localeCompare(a.date));
    const list = preview.querySelector("#book-records");
    list.replaceChildren(
      ...rows.map((record) => {
        const row = document.createElement("li");
        const identity = document.createElement("span");
        const day = document.createElement("time");
        day.dateTime = record.date;
        day.textContent = record.date;
        const label = document.createElement("span");
        label.textContent = record.label;
        const basis = document.createElement("small");
        basis.textContent = record.basis;
        label.append(basis);
        identity.append(day, label);
        const amount = document.createElement("div");
        amount.className = "record-amount";
        const money = document.createElement("strong");
        money.className = "money";
        money.dataset.value = record.value;
        money.dataset.native = book.currency;
        const unit = document.createElement("span");
        unit.className = "record-unit";
        unit.textContent = book.currency;
        amount.append(money, " ", unit);
        if (record.label === "入金") {
          const running = document.createElement("small");
          running.className = "record-total";
          const totalMoney = document.createElement("span");
          totalMoney.className = "money";
          totalMoney.dataset.value = book.investment;
          totalMoney.dataset.native = book.currency;
          running.append("累计净投入 ", totalMoney, ` ${book.currency}`);
          amount.append(running);
        }
        row.append(identity, amount);
        return row;
      }),
    );
    preview.querySelector(
      "#book-record-view .preview-explanation",
    ).textContent =
      "仅展示部分虚构记录；原币种记账，出入金与资产估值分开保存。";
  }

  function selectView(view, focus = false) {
    state.view = view;
    tabs.forEach((tab) => {
      const active = tab.dataset.view === view;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      preview.querySelector(`#panel-${tab.dataset.view}`).hidden = !active;
      if (active && focus) tab.focus();
    });
    preview.querySelector("#demo-title").textContent = {
      overview: "总览",
      assets: "资产",
      books: "投资账本",
    }[view];
    preview.querySelector(".currency-picker").hidden = view !== "overview";
    overviewChart.reset();
    bookChart.reset();
  }

  function selectBook(id, openView = true) {
    const book = books[id];
    if (!book) return;
    state.book = id;
    preview
      .querySelectorAll("[data-book]")
      .forEach((button) =>
        button.setAttribute("aria-pressed", String(button.dataset.book === id)),
      );
    renderBook();
    if (openView) {
      selectView("books");
      announce(`正在展示${book.name}虚构账本，原币种 ${book.currency}。`);
    }
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectView(tab.dataset.view));
    tab.addEventListener("keydown", (event) => {
      const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      if (!(event.key in keys) && !["Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const target =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : (index + keys[event.key] + tabs.length) % tabs.length;
      selectView(tabs[target].dataset.view, true);
    });
  });
  const rail = preview.querySelector("[role=tablist]");
  const narrow = matchMedia("(max-width: 639px)");
  const updateOrientation = () =>
    rail.setAttribute(
      "aria-orientation",
      narrow.matches ? "horizontal" : "vertical",
    );
  narrow.addEventListener("change", updateOrientation);
  updateOrientation();

  preview
    .querySelector("#demo-currency")
    .addEventListener("change", (event) => {
      if (!(event.target.value in rates)) return;
      state.currency = event.target.value;
      updateMoney();
      announce(
        `总览按固定演示汇率换算为 ${state.currency}，账本与持仓保留原币种。`,
      );
    });
  preview
    .querySelector("#privacy-toggle")
    .addEventListener("click", (event) => {
      state.private = !state.private;
      const button = event.currentTarget;
      button.setAttribute("aria-pressed", String(state.private));
      button.setAttribute(
        "aria-label",
        state.private ? "显示演示金额" : "隐藏演示金额",
      );
      button
        .querySelector("use")
        .setAttribute("href", state.private ? "#i-eye-off" : "#i-eye");
      renderBook();
      announce(
        state.private
          ? "演示金额与收益率已遮罩，走势、日期和记录仍可查看。"
          : "演示金额已显示。",
      );
    });
  preview.querySelectorAll("[data-range]").forEach((button) =>
    button.addEventListener("click", () => {
      state.range = button.dataset.range;
      preview
        .querySelectorAll("[data-range]")
        .forEach((item) =>
          item.setAttribute("aria-pressed", String(item === button)),
        );
      preview
        .querySelector('[data-custom-range="overview"]')
        .setAttribute("aria-pressed", "false");
      drawChart();
      const shown = selectedSeries(observations, "overview");
      announce(`展示 ${shown[0].date} 至 ${shown.at(-1).date} 的虚构走势。`);
    }),
  );
  preview
    .querySelectorAll("[data-book]")
    .forEach((button) =>
      button.addEventListener("click", () => selectBook(button.dataset.book)),
    );
  preview.querySelectorAll("[data-open-book]").forEach((button) =>
    button.addEventListener("click", () => {
      selectBookView("performance");
      selectBook(button.dataset.openBook);
      tabs.find((tab) => tab.dataset.view === "books").focus();
    }),
  );
  function selectBookView(view) {
    state.bookView = view;
    preview.querySelector("#book-performance").hidden = view !== "performance";
    preview.querySelector("#book-record-view").hidden = view !== "records";
    preview.querySelectorAll("[data-book-view]").forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.bookView === view),
      );
    });
    bookChart.reset();
  }
  for (const [attribute, key, callback] of [
    ["data-book-view", "bookView", (value) => selectBookView(value)],
    ["data-book-range", "bookRange", () => renderBook()],
    ["data-book-curve", "bookCurve", () => renderBook()],
    ["data-record-filter", "recordFilter", () => renderBook()],
  ]) {
    preview.querySelectorAll(`[${attribute}]`).forEach((button) => {
      button.addEventListener("click", () => {
        state[key] = button.getAttribute(attribute);
        preview.querySelectorAll(`[${attribute}]`).forEach((item) => {
          item.setAttribute("aria-pressed", String(item === button));
        });
        if (key === "bookRange")
          preview
            .querySelector('[data-custom-range="books"]')
            .setAttribute("aria-pressed", "false");
        callback(state[key]);
      });
    });
  }
  const dialog = document.querySelector("#demo-range-dialog");
  const startField = document.querySelector("#demo-range-start");
  const endField = document.querySelector("#demo-range-end");
  const rangeError = document.querySelector("#range-error");
  let rangeScope = "books";
  let rangeTrigger;
  preview.querySelectorAll("[data-custom-range]").forEach((button) =>
    button.addEventListener("click", () => {
      rangeScope = button.dataset.customRange;
      rangeTrigger = button;
      const shown = selectedSeries(
        rangeScope === "books" ? books[state.book].observations : observations,
        rangeScope,
      );
      startField.value = shown[0].date;
      endField.value = shown.at(-1).date;
      startField.max = endField.value;
      endField.min = startField.value;
      rangeError.textContent = "";
      dialog.showModal();
    }),
  );
  startField.addEventListener("input", () => {
    endField.min = startField.value;
    rangeError.textContent = "";
  });
  endField.addEventListener("input", () => {
    startField.max = endField.value;
    rangeError.textContent = "";
  });
  dialog
    .querySelectorAll("[data-close-range]")
    .forEach((button) =>
      button.addEventListener("click", () => dialog.close()),
    );
  dialog.addEventListener("close", () => rangeTrigger?.focus());
  dialog.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (
      !startField.value ||
      !endField.value ||
      startField.value > endField.value ||
      startField.value < dates[0] ||
      endField.value > dates.at(-1)
    ) {
      rangeError.textContent = "请选择演示范围内的有效起止日期。";
      return;
    }
    state.customRanges[rangeScope] = {
      start: startField.value,
      end: endField.value,
    };
    const booksScope = rangeScope === "books";
    state[booksScope ? "bookRange" : "range"] = "custom";
    preview
      .querySelectorAll(booksScope ? "[data-book-range]" : "[data-range]")
      .forEach((button) => button.setAttribute("aria-pressed", "false"));
    rangeTrigger.setAttribute("aria-pressed", "true");
    if (booksScope) renderBook();
    else drawChart();
    announce(`展示 ${startField.value} 至 ${endField.value} 的虚构走势。`);
    dialog.close();
  });
  preview.querySelectorAll("[data-benchmark]").forEach((button) =>
    button.addEventListener("click", () => {
      const symbol = button.dataset.benchmark;
      if (state.benchmarks.has(symbol)) state.benchmarks.delete(symbol);
      else state.benchmarks.add(symbol);
      button.setAttribute("aria-pressed", String(state.benchmarks.has(symbol)));
      renderBook();
    }),
  );
  selectBook("us", false);
  drawChart();
  document.fonts.ready.then(updateMoney);
  preview
    .querySelectorAll("button[disabled], select[disabled]")
    .forEach((element) => {
      element.disabled = false;
    });
}
