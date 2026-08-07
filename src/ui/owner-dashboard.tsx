"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { decimalToFixed } from "@/domain/decimal";
import { shanghaiDay } from "@/domain/daily-asset-snapshots";
import { portfolioSourceTotal } from "@/domain/evm-token-preferences";
import type {
  Card,
  CardSpan,
  DailyAssetTrendObservation,
  FormalDailySettlement,
} from "@/server/ports";
import type { ReportingCurrency } from "@/domain/valuation";
import { AssetRefreshControls } from "@/ui/asset-refresh-controls";
import {
  CardLayoutEditor,
  type CardDragControls,
} from "@/ui/card-layout/card-layout-editor";
import type { AssetSourceView } from "@/ui/longbridge-asset-card";
import {
  TREND_RANGE_STORAGE_KEY,
  TotalAssetOverview,
  type TrendRange,
} from "@/ui/total-asset-overview";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeNotice } from "@/ui/vibe/vibe-notice";

function cardName(card: Card): string {
  return card.title;
}

function sourceName(source: AssetSourceView): string {
  if (source.displayName) return source.displayName;
  if (source.kind === "longbridge") return "长桥资产";
  if (source.kind === "binance") return "Binance 资产";
  if (source.kind === "okx") return "OKX 资产";
  if (source.kind === "bitget") return "Bitget 资产";
  if (source.kind === "bit") return "BIT / Matrixport 资产";
  if (source.kind === "evm-watch-ethereum") return "Ethereum 观察钱包";
  if (source.kind === "evm-watch-bsc") return "BNB Smart Chain 观察钱包";
  return source.label;
}

function groupedAmount(value: string): string {
  const [integer, fraction] = decimalToFixed(value, 2).split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped}.${fraction}`;
}

function CardCornerMarks() {
  return (
    <span className="card-corner-marks" aria-hidden="true">
      <i className="card-corner-mark card-corner-mark-top-left" />
      <i className="card-corner-mark card-corner-mark-bottom-left" />
    </span>
  );
}

function OverviewCardSummary({
  card,
  source,
  showSensitiveInfo,
}: {
  card: Card;
  source?: AssetSourceView;
  showSensitiveInfo: boolean;
}) {
  const sourceTotal = source ? portfolioSourceTotal(source) : null;
  const status = source?.lifecycle === "disconnected"
    ? "已断开"
    : source?.sync.error
      ? "同步异常"
      : source?.sync.status === "expired"
        ? "数据过期"
        : "已同步";

  return (
    <div
      className={`overview-card-summary${source ? " overview-card-summary--source" : ""}`}
    >
      <p className="card-label">
        {source ? "SOURCE / SUMMARY" : "ASSET / SUMMARY"}
      </p>
      <h2 className="overview-card-summary-title">
        {source ? sourceName(source) : cardName(card)}
      </h2>
      {source ? (
        <>
          <p className="overview-card-summary-amount">
            {source.kind === "manual" && source.hasManualRecord === false
              ? "尚未记录"
              : showSensitiveInfo
                ? `${groupedAmount(sourceTotal!.amount)} ${sourceTotal!.currency}`
                : "••••••"}
          </p>
          <p className="overview-card-summary-status">{status}</p>
        </>
      ) : (
        <p className="overview-card-summary-status">{card.body}</p>
      )}
    </div>
  );
}

function moveVisibleCard(
  cards: Card[],
  cardId: string,
  offset: -1 | 1,
): Card[] | null {
  const visibleCards = cards.filter((card) => !card.hidden);
  const currentIndex = visibleCards.findIndex(({ id }) => id === cardId);
  const targetIndex = currentIndex + offset;
  if (
    currentIndex < 0 ||
    targetIndex < 0 ||
    targetIndex >= visibleCards.length
  ) {
    return null;
  }

  const reorderedVisibleCards = [...visibleCards];
  [reorderedVisibleCards[currentIndex], reorderedVisibleCards[targetIndex]] = [
    reorderedVisibleCards[targetIndex],
    reorderedVisibleCards[currentIndex],
  ];
  let visibleIndex = 0;
  return cards.map((card) =>
    card.hidden ? card : reorderedVisibleCards[visibleIndex++],
  );
}

async function cardRequest(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(result?.error ?? "保存失败，请重试");
  }
}

export function OwnerDashboard({
  cards,
  assetSources,
  dailyAssetTrendObservations,
  formalDailySettlements,
  currentDay,
  mode = "owner",
}: {
  cards: Card[];
  assetSources: AssetSourceView[];
  dailyAssetTrendObservations: DailyAssetTrendObservation[];
  formalDailySettlements: FormalDailySettlement[];
  currentDay: string;
  mode?: "demo" | "owner";
}) {
  const demoMode = mode === "demo";
  const [error, setError] = useState("");
  const [showSensitiveInfo, setShowSensitiveInfo] = useState(true);
  const [reportingCurrency, setReportingCurrency] =
    useState<ReportingCurrency>("USD");
  const [trendRange, setTrendRange] = useState<TrendRange>("30d");
  const [displayCards, setDisplayCards] = useState(cards);
  const [layoutMode, setLayoutMode] = useState(false);
  const [resizingId, setResizingId] = useState<string | null>(null);
  const [resizePreview, setResizePreview] = useState<{
    id: string;
    span: CardSpan;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const [assetRefreshPending, setAssetRefreshPending] = useState(false);
  const resizeStart = useRef<{
    cardId: string;
    pointerId: number;
    startSpan: CardSpan;
    startX: number;
    left: number;
    top: number;
    gridWidth: number;
    columnWidth: number;
    gap: number;
    height: number;
    columnStep: number;
    canResizeWidth: boolean;
    previewSpan: CardSpan;
    stopListening?: () => void;
  } | null>(null);
  const reportingCurrencyStorageKey = demoMode
    ? "demo-reporting-currency"
    : "reporting-currency";
  const trendRangeStorageKey = demoMode
    ? "demo-asset-trend-range"
    : TREND_RANGE_STORAGE_KEY;
  const hasEvmSources = assetSources.some(
    (source) =>
      source.lifecycle !== "disconnected" &&
      source.kind.startsWith("evm-watch-"),
  );
  const hasNonEvmSources = assetSources.some(
    (source) =>
      source.lifecycle !== "disconnected" &&
      source.kind !== "manual" &&
      !source.kind.startsWith("evm-watch-"),
  );
  const needsDailyEvmPriceRefresh = assetSources.some(
    (source) =>
      source.lifecycle !== "disconnected" &&
      source.kind.startsWith("evm-watch-") &&
      shanghaiDay(source.sync.lastAttemptAt) !== currentDay,
  );
  const visibleCards = displayCards.filter((card) => !card.hidden);
  const hiddenCards = displayCards.filter((card) => card.hidden);

  useEffect(() => {
    setDisplayCards(cards);
  }, [cards]);

  useEffect(() => {
    const savedCurrency = window.localStorage.getItem(reportingCurrencyStorageKey);
    if (
      savedCurrency === "USD" ||
      savedCurrency === "CNY" ||
      savedCurrency === "HKD"
    ) {
      setReportingCurrency(savedCurrency);
    }
  }, [reportingCurrencyStorageKey]);

  useEffect(() => {
    const savedRange = window.localStorage.getItem(trendRangeStorageKey);
    if (
      savedRange === "7d" ||
      savedRange === "30d" ||
      savedRange === "90d" ||
      savedRange === "1y" ||
      savedRange === "all"
    ) {
      setTrendRange(savedRange);
    }
  }, [trendRangeStorageKey]);

  function sourceForCard(card: Card) {
    return card.sourceId
      ? assetSources.find((item) => item.id === card.sourceId)
      : undefined;
  }

  function changeReportingCurrency(currency: ReportingCurrency) {
    setReportingCurrency(currency);
    window.localStorage.setItem(reportingCurrencyStorageKey, currency);
  }

  function changeTrendRange(range: TrendRange) {
    setTrendRange(range);
    window.localStorage.setItem(trendRangeStorageKey, range);
  }

  async function persistLayout(nextCards: Card[], previousCards: Card[]) {
    setDisplayCards(nextCards);
    setError("");
    if (demoMode) return;
    try {
      await cardRequest("/api/asset-cards/layout", "PUT", {
        cards: nextCards.map(({ id, span, startsNewRow, hidden }) => ({
          id,
          span,
          startsNewRow,
          hidden,
        })),
      });
    } catch {
      setDisplayCards(previousCards);
      setError("布局保存失败，已恢复原布局");
    }
  }

  function updateCardLayout(cardId: string, update: (card: Card) => Card) {
    const previousCards = displayCards;
    const nextCards = previousCards.map((card) =>
      card.id === cardId ? update(card) : card,
    );
    void persistLayout(nextCards, previousCards);
  }

  function moveCard(cardId: string, offset: -1 | 1) {
    const previousCards = displayCards;
    const nextCards = moveVisibleCard(previousCards, cardId, offset);
    if (nextCards !== null) void persistLayout(nextCards, previousCards);
  }

  function spanForResize(
    event: Pick<PointerEvent<HTMLElement>, "clientX">,
  ): CardSpan | null {
    const start = resizeStart.current;
    if (!start) return null;
    if (!start.canResizeWidth) return start.startSpan;
    const nextSpan = Math.round(
      start.startSpan + (event.clientX - start.startX) / start.columnStep,
    );
    if (nextSpan < 1) return 1;
    if (nextSpan > 3) return 3;
    return nextSpan as CardSpan;
  }

  function resizePreviewGeometry(span: CardSpan, height: number) {
    const start = resizeStart.current;
    if (!start) return null;
    const visualSpan = start.canResizeWidth ? span : start.startSpan;
    const width =
      start.columnWidth * visualSpan + start.gap * Math.max(0, visualSpan - 1);
    return {
      id: start.cardId,
      span: visualSpan,
      left: Math.min(start.left, Math.max(0, start.gridWidth - width)),
      top: start.top,
      width,
      height,
    };
  }

  function startResizing(event: PointerEvent<HTMLButtonElement>, card: Card) {
    if (!layoutMode || event.button !== 0 || !event.isPrimary) return;
    const grid = event.currentTarget.closest<HTMLElement>(".card-grid");
    if (!grid) return;

    const gridStyle = window.getComputedStyle(grid);
    const columns = gridStyle.gridTemplateColumns.trim().split(/\s+/).length;
    const gap = Number.parseFloat(gridStyle.columnGap) || 0;
    const gridBox = grid.getBoundingClientRect();
    const columnWidth = (gridBox.width - gap * (columns - 1)) / columns;
    const cardElement = event.currentTarget.closest<HTMLElement>(".card");
    if (!cardElement) return;
    const cardBox = cardElement.getBoundingClientRect();

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeStart.current = {
      cardId: card.id,
      pointerId: event.pointerId,
      startSpan: card.span,
      startX: event.clientX,
      left: cardBox.left - gridBox.left,
      top: cardBox.top - gridBox.top,
      gridWidth: gridBox.width,
      columnWidth,
      gap,
      height: cardBox.height,
      columnStep: columnWidth + gap,
      canResizeWidth: columns >= 3,
      previewSpan: card.span,
    };
    const finishOnWindowPointerUp = (windowEvent: globalThis.PointerEvent) => {
      if (resizeStart.current?.pointerId === windowEvent.pointerId) {
        commitResizing();
      }
    };
    window.addEventListener("pointerup", finishOnWindowPointerUp, true);
    resizeStart.current.stopListening = () => {
      window.removeEventListener("pointerup", finishOnWindowPointerUp, true);
    };
    setResizePreview(resizePreviewGeometry(card.span, cardBox.height));
    setResizingId(card.id);
  }

  function moveResizing(event: PointerEvent<HTMLButtonElement>) {
    const start = resizeStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const span = spanForResize(event);
    if (span === null) return;
    start.previewSpan = span;
    setResizePreview(resizePreviewGeometry(span, start.height));
  }

  function commitResizing() {
    const start = resizeStart.current;
    if (!start) return;
    const span = start.previewSpan;
    resizeStart.current = null;
    start.stopListening?.();
    setResizingId(null);
    setResizePreview(null);
    if (span === start.startSpan) return;

    const previousCards = displayCards;
    const nextCards = previousCards.map((card) =>
      card.id === start.cardId ? { ...card, span } : card,
    );
    void persistLayout(nextCards, previousCards);
  }

  function finishResizing(event: PointerEvent<HTMLButtonElement>) {
    const start = resizeStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    commitResizing();
  }

  function cancelResizing() {
    const start = resizeStart.current;
    if (!start) return;
    resizeStart.current = null;
    start.stopListening?.();
    setResizingId(null);
    setResizePreview(null);
  }

  function resizeFromKeyboard(
    event: KeyboardEvent<HTMLButtonElement>,
    card: Card,
  ) {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const span = Math.max(
      1,
      Math.min(
        3,
        card.span + (event.key === "ArrowRight" ? 1 : -1),
      ),
    ) as CardSpan;
    if (span === card.span) return;
    updateCardLayout(card.id, (current) => ({ ...current, span }));
  }

  function renderLayoutCard(card: Card, controls: CardDragControls) {
    const source = sourceForCard(card);
    const cardIndex = visibleCards.findIndex(({ id }) => id === card.id);
    return (
      <article
        ref={controls.cardRef}
        className={`card vibe-data-card span-${card.span}${card.startsNewRow ? " starts-new-row" : ""}${controls.isDragging ? " card-dragging" : ""}${resizingId === card.id ? " card-resizing" : ""}`}
        data-layout-card-id={card.id}
        data-layout-mode={layoutMode ? "true" : "false"}
        data-testid="card"
        data-vibe-surface="data-card"
        tabIndex={-1}
      >
        <CardCornerMarks />
        <OverviewCardSummary
          card={card}
          source={source}
          showSensitiveInfo={showSensitiveInfo}
        />
        {layoutMode ? (
          <>
            <div className="layout-card-actions" aria-label={`${cardName(card)}布局操作`}>
              <VibeButton
                aria-label={`${card.startsNewRow ? "取消强制" : "强制"}${cardName(card)}换行`}
                disabled={controls.disabled}
                onClick={() =>
                  updateCardLayout(card.id, (current) => ({
                    ...current,
                    startsNewRow: !current.startsNewRow,
                  }))
                }
                type="button"
                variant="text"
              >
                {card.startsNewRow ? "取消换行" : "强制换行"}
              </VibeButton>
              <VibeButton
                aria-label={`隐藏${cardName(card)}`}
                disabled={controls.disabled}
                onClick={() =>
                  updateCardLayout(card.id, (current) => ({
                    ...current,
                    hidden: true,
                  }))
                }
                type="button"
                variant="text"
              >
                隐藏卡片
              </VibeButton>
            </div>
            <div className="mobile-card-sort-actions" data-layout-mobile-actions>
              <button
                aria-label={`上移${cardName(card)}`}
                disabled={controls.disabled || cardIndex <= 0}
                onClick={() => moveCard(card.id, -1)}
                type="button"
              >
                上移
              </button>
              <button
                aria-label={`下移${cardName(card)}`}
                disabled={
                  controls.disabled || cardIndex >= visibleCards.length - 1
                }
                onClick={() => moveCard(card.id, 1)}
                type="button"
              >
                下移
              </button>
            </div>
            <button
              className="layout-resize-handle"
              data-vibe-component="layout-control"
              aria-label={`调整${cardName(card)}宽度，当前宽度 ${card.span} 格；可拖动或使用左右方向键`}
              disabled={controls.disabled}
              draggable={false}
              onDragStart={(event) => event.preventDefault()}
              onKeyDown={(event) => resizeFromKeyboard(event, card)}
              onLostPointerCapture={finishResizing}
              onPointerCancel={cancelResizing}
              onPointerDown={(event) => startResizing(event, card)}
              onPointerMove={moveResizing}
              onPointerUp={finishResizing}
              type="button"
            />
            <button
              ref={controls.handleRef}
              className="layout-drag-handle"
              data-vibe-component="layout-control"
              {...controls.handleAttributes}
              {...controls.handleListeners}
              aria-label={`拖动${cardName(card)}调整排序`}
              disabled={controls.disabled}
              type="button"
            />
          </>
        ) : null}
      </article>
    );
  }

  function renderCardPreview(card: Card) {
    return (
      <OverviewCardSummary
        card={card}
        source={sourceForCard(card)}
        showSensitiveInfo={showSensitiveInfo}
      />
    );
  }

  function toggleLayoutMode() {
    if (layoutMode) cancelResizing();
    setLayoutMode((current) => !current);
  }

  return (
    <>
      {assetSources.length > 0 ? (
        <article
          className="card vibe-data-card total-overview-card"
          data-testid="total-overview-card"
          data-vibe-surface="data-card"
          tabIndex={-1}
        >
          <CardCornerMarks />
          <TotalAssetOverview
            sources={assetSources}
            currency={reportingCurrency}
            onCurrencyChange={changeReportingCurrency}
            trendRange={trendRange}
            onTrendRangeChange={changeTrendRange}
            history={dailyAssetTrendObservations}
            formalDailySettlements={formalDailySettlements}
            currentDay={currentDay}
            showSensitiveInfo={showSensitiveInfo}
            storageNamespace={demoMode ? "demo" : "owner"}
          />
        </article>
      ) : null}
      <div className="dashboard-control-deck" data-vibe-module="control-deck">
        <div className="owner-toolbar" aria-label="总览快捷控制">
          <VibeButton
            type="button"
            aria-pressed={showSensitiveInfo}
            data-testid="sensitive-info-toggle"
            onClick={() => setShowSensitiveInfo((current) => !current)}
            variant="outline"
          >
            {showSensitiveInfo ? "隐藏关键信息" : "显示关键信息"}
          </VibeButton>
          <VibeButton
            type="button"
            aria-pressed={layoutMode}
            onClick={toggleLayoutMode}
            variant={layoutMode ? "primary" : "outline"}
          >
            {layoutMode ? "退出布局管理" : "进入布局管理"}
          </VibeButton>
        </div>
        {demoMode ? (
          <VibeButton disabled type="button" variant="primary">
            立即刷新资产
          </VibeButton>
        ) : (
          <AssetRefreshControls
            enabled={assetSources.some(
              (source) =>
                source.lifecycle !== "disconnected" &&
                source.kind !== "manual",
            )}
            hasEvmSources={hasEvmSources}
            hasNonEvmSources={hasNonEvmSources}
            needsDailyEvmPriceRefresh={needsDailyEvmPriceRefresh}
            onPendingChange={setAssetRefreshPending}
          />
        )}
      </div>
      {error ? (
        <VibeNotice className="content-error" role="alert" tone="error">
          {error}
        </VibeNotice>
      ) : null}
      <CardLayoutEditor
        cards={displayCards}
        editable={layoutMode}
        renderCard={renderLayoutCard}
        renderOverlay={renderCardPreview}
        gridOverlay={
          <>
            {resizePreview ? (
              <div
                className={`layout-resize-preview span-${resizePreview.span}`}
                data-testid="layout-resize-preview"
                data-vibe-state="resize-preview"
                aria-hidden="true"
                style={{
                  left: resizePreview.left,
                  top: resizePreview.top,
                  width: resizePreview.width,
                  height: resizePreview.height,
                }}
              />
            ) : null}
            {visibleCards.length === 0 && assetSources.length === 0 ? (
              <div className="empty-state" data-testid="empty-state">
                <p className="empty-title">暂无资产来源</p>
                <p className="empty-hint">请在资产来源中接入只读账户、观察钱包或手工资产记录。</p>
              </div>
            ) : null}
          </>
        }
        onCommit={persistLayout}
        onCardsChangedDuringDrag={() => {
          setError("资产来源已变化，请重新调整布局");
        }}
      />
      {layoutMode && hiddenCards.length > 0 ? (
        <section
          className="hidden-layout-cards"
          aria-labelledby="hidden-layout-cards-title"
        >
          <h2 id="hidden-layout-cards-title">已隐藏卡片</h2>
          {hiddenCards.map((card) => (
            <VibeButton
              key={card.id}
              aria-label={`重新显示${cardName(card)}`}
              onClick={() =>
                updateCardLayout(card.id, (current) => ({
                  ...current,
                  hidden: false,
                }))
              }
              type="button"
              variant="text"
            >
              重新显示 {cardName(card)}
            </VibeButton>
          ))}
        </section>
      ) : null}
    </>
  );
}
