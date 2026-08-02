"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { assetSourceDefaultDisplayName } from "@/domain/asset-source-display-name";
import { portfolioSourceTotal } from "@/domain/evm-token-preferences";
import { shanghaiDay } from "@/domain/daily-asset-snapshots";
import type {
  Card,
  CardSpan,
  DailyAssetSnapshot,
  DailyAssetTrendObservation,
} from "@/server/ports";
import type { ReportingCurrency } from "@/domain/valuation";
import { AssetSourceFlow } from "@/ui/asset-source-flow";
import { AssetRefreshControls } from "@/ui/asset-refresh-controls";
import {
  CardLayoutEditor,
  type CardDragControls,
} from "@/ui/card-layout/card-layout-editor";
import {
  AssetSourceCard,
  type AssetSourceView,
} from "@/ui/longbridge-asset-card";
import {
  DEFAULT_PROFIT_COLOR_SCHEME,
  isProfitColorScheme,
  PROFIT_COLOR_SCHEME_STORAGE_KEY,
  type ProfitColorScheme,
} from "@/ui/profit-color-scheme";
import {
  TREND_RANGE_STORAGE_KEY,
  TotalAssetOverview,
  type TrendRange,
} from "@/ui/total-asset-overview";
import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
import { VibeDialog } from "@/ui/vibe/vibe-dialog";
import { VibeField } from "@/ui/vibe/vibe-field";
import { VibeMenu } from "@/ui/vibe/vibe-menu";
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
  if (source.kind === "evm-watch-ethereum") return "Ethereum 观察钱包";
  if (source.kind === "evm-watch-bsc") return "BNB Smart Chain 观察钱包";
  return source.label;
}

function groupedAmount(value: string): string {
  const [integer, fraction] = value.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

function CardCornerMarks() {
  return (
    <span className="card-corner-marks" aria-hidden="true">
      <i className="card-corner-mark card-corner-mark-top-left" />
      <i className="card-corner-mark card-corner-mark-bottom-left" />
    </span>
  );
}

function MobileCardIdentity({
  card,
  source,
  cardIndex,
  showSensitiveInfo,
}: {
  card: Card;
  source?: AssetSourceView;
  cardIndex: number;
  showSensitiveInfo: boolean;
}) {
  const sourceTotal = source ? portfolioSourceTotal(source) : null;
  return (
    <>
      <span className="mobile-card-summary-index">
        {String(Math.max(0, cardIndex) + 1).padStart(2, "0")}
      </span>
      <span className="mobile-card-summary-copy">
        <strong>{source ? sourceName(source) : cardName(card)}</strong>
        {source ? (
          <span>
            {showSensitiveInfo
              ? groupedAmount(sourceTotal!.amount)
              : "••••••"}{" "}
            {sourceTotal!.currency}
          </span>
        ) : null}
      </span>
    </>
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
  dailyAssetSnapshots,
  dailyAssetTrendObservations,
  currentDay,
}: {
  cards: Card[];
  assetSources: AssetSourceView[];
  dailyAssetSnapshots: DailyAssetSnapshot[];
  dailyAssetTrendObservations: DailyAssetTrendObservation[];
  currentDay: string;
}) {
  const [error, setError] = useState("");
  const [showSensitiveInfo, setShowSensitiveInfo] = useState(true);
  const [reportingCurrency, setReportingCurrency] =
    useState<ReportingCurrency>("USD");
  const [trendRange, setTrendRange] = useState<TrendRange>("30d");
  const [profitColorScheme, setProfitColorScheme] =
    useState<ProfitColorScheme>(DEFAULT_PROFIT_COLOR_SCHEME);
  const [displayCards, setDisplayCards] = useState(cards);
  const [expandedMobileCardIds, setExpandedMobileCardIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [mobileOverviewExpanded, setMobileOverviewExpanded] = useState(false);
  const [mobileLayoutMode, setMobileLayoutMode] = useState(false);
  const [resizingId, setResizingId] = useState<string | null>(null);
  const [resizePreview, setResizePreview] = useState<{
    id: string;
    span: CardSpan;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
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
  const [deleteTarget, setDeleteTarget] = useState<{
    source: AssetSourceView;
    stage: 1 | 2;
  } | null>(null);
  const [managementTarget, setManagementTarget] =
    useState<AssetSourceView | null>(null);
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [displayNamePending, setDisplayNamePending] = useState(false);
  const [lifecyclePending, setLifecyclePending] = useState(false);
  const hasEvmSources = assetSources.some(
    (source) =>
      source.lifecycle !== "disconnected" &&
      source.kind.startsWith("evm-watch-"),
  );
  const hasNonEvmSources = assetSources.some(
    (source) =>
      source.lifecycle !== "disconnected" &&
      !source.kind.startsWith("evm-watch-"),
  );
  const needsDailyEvmPriceRefresh = assetSources.some(
    (source) =>
      source.lifecycle !== "disconnected" &&
      source.kind.startsWith("evm-watch-") &&
      shanghaiDay(source.sync.lastAttemptAt) !== currentDay,
  );
  const displayNameChanged =
    managementTarget !== null &&
    displayNameDraft.trim() !== (managementTarget.displayName ?? "");

  useEffect(() => {
    setDisplayCards(cards);
  }, [cards]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(
        PROFIT_COLOR_SCHEME_STORAGE_KEY,
      );
      if (isProfitColorScheme(saved)) setProfitColorScheme(saved);
    } catch {
      // The current page can still use the default scheme when storage is unavailable.
    }
  }, []);

  useEffect(() => {
    const savedCurrency = window.localStorage.getItem("reporting-currency");
    if (
      savedCurrency === "USD" ||
      savedCurrency === "CNY" ||
      savedCurrency === "HKD"
    ) {
      setReportingCurrency(savedCurrency);
    }
  }, []);

  useEffect(() => {
    const savedRange = window.localStorage.getItem(TREND_RANGE_STORAGE_KEY);
    if (
      savedRange === "7d" ||
      savedRange === "30d" ||
      savedRange === "90d" ||
      savedRange === "1y" ||
      savedRange === "all"
    ) {
      setTrendRange(savedRange);
    }
  }, []);

  function changeReportingCurrency(currency: ReportingCurrency) {
    setReportingCurrency(currency);
    window.localStorage.setItem("reporting-currency", currency);
  }

  function changeTrendRange(range: TrendRange) {
    setTrendRange(range);
    window.localStorage.setItem(TREND_RANGE_STORAGE_KEY, range);
  }

  useEffect(() => {
    const availableIds = new Set(cards.map(({ id }) => id));
    setExpandedMobileCardIds((current) => {
      const next = new Set(
        [...current].filter((cardId) => availableIds.has(cardId)),
      );
      return next.size === current.size ? current : next;
    });
  }, [cards]);

  useEffect(() => {
    const mobileQuery = window.matchMedia("(max-width: 639px)");
    const leaveMobileLayoutMode = () => {
      if (!mobileQuery.matches) setMobileLayoutMode(false);
    };
    mobileQuery.addEventListener("change", leaveMobileLayoutMode);
    return () => mobileQuery.removeEventListener("change", leaveMobileLayoutMode);
  }, []);

  async function persistLayout(nextCards: Card[], previousCards: Card[]) {
    setDisplayCards(nextCards);
    setError("");
    try {
      await cardRequest("/api/asset-cards/layout", "PUT", {
        cards: nextCards.map(({ id, span, startsNewRow }) => ({ id, span, startsNewRow })),
      });
    } catch {
      setDisplayCards(previousCards);
      setError("布局保存失败，已恢复原布局");
    }
  }

  function spanForResize(event: Pick<PointerEvent<HTMLElement>, "clientX">): CardSpan | null {
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
    if (event.button !== 0 || !event.isPrimary) return;
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
    setDisplayCards((current) => {
      const nextCards = current.map((card) =>
        card.id === start.cardId ? { ...card, span } : card,
      );
      void persistLayout(nextCards, current);
      return nextCards;
    });
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

  function resizeFromKeyboard(event: KeyboardEvent<HTMLButtonElement>, card: Card) {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const span = Math.max(
      1,
      Math.min(3, card.span + (event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0)),
    ) as CardSpan;
    if (span === card.span) return;
    const nextCards = displayCards.map((item) =>
      item.id === card.id ? { ...item, span } : item,
    );
    setDisplayCards(nextCards);
    void persistLayout(nextCards, displayCards);
  }

  async function setSourceHidden(source: AssetSourceView, hidden: boolean) {
    setError("");
    try {
      await cardRequest(`/api/asset-sources/${encodeURIComponent(source.id)}`, "PATCH", {
        action: "visibility",
        hidden,
      });
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "来源操作失败");
    }
  }

  function openSourceManagement(source: AssetSourceView) {
    setDisplayNameDraft(source.displayName ?? "");
    setDisplayNamePending(false);
    setManagementTarget(source);
  }

  function closeSourceManagement() {
    setManagementTarget(null);
    setDisplayNameDraft("");
  }

  async function saveSourceDisplayName(source: AssetSourceView) {
    setDisplayNamePending(true);
    setError("");
    try {
      await cardRequest(`/api/asset-sources/${encodeURIComponent(source.id)}`, "PATCH", {
        action: "rename",
        displayName: displayNameDraft,
      });
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "名称保存失败，请重试");
      setDisplayNamePending(false);
    }
  }

  async function disconnectSource(source: AssetSourceView) {
    if (!window.confirm(`断开“${sourceName(source)}”将删除只读凭证并停止同步，但保留已有数据和历史快照。确认断开吗？`)) return;
    setError("");
    try {
      await cardRequest(`/api/asset-sources/${encodeURIComponent(source.id)}`, "PATCH", {
        action: "disconnect",
      });
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "断开失败，请重试");
    }
  }

  async function permanentlyDeleteSource() {
    if (!deleteTarget) return;
    setLifecyclePending(true);
    setError("");
    try {
      await cardRequest(
        `/api/asset-sources/${encodeURIComponent(deleteTarget.source.id)}`,
        "DELETE",
        { confirmation: "DELETE_SOURCE_DATA" },
      );
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "永久删除失败，请重试");
      setDeleteTarget(null);
      setLifecyclePending(false);
    }
  }

  const visibleCards = displayCards.filter((card) => !card.hidden);
  const hiddenAssetCards = cards.flatMap((card) => {
    if (!card.hidden || !card.sourceId) return [];
    const source = assetSources.find((item) => item.id === card.sourceId);
    return source ? [{ card, source }] : [];
  });

  function sourceForCard(card: Card) {
    return card.sourceId
      ? assetSources.find((item) => item.id === card.sourceId)
      : undefined;
  }

  function toggleMobileCard(cardId: string) {
    setExpandedMobileCardIds((current) => {
      const next = new Set(current);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });
  }

  function moveMobileCard(cardId: string, offset: -1 | 1) {
    const previousCards = displayCards;
    const nextCards = moveVisibleCard(previousCards, cardId, offset);
    if (!nextCards) return;
    void persistLayout(nextCards, previousCards);
  }

  function renderCardBody(card: Card) {
    const source = sourceForCard(card);
    const reportingExchangeRates = assetSources.flatMap((assetSource) =>
      assetSource.kind === "longbridge"
        ? assetSource.snapshot.exchangeRates
        : [],
    );
    return source ? (
      <AssetSourceCard
        source={source}
        history={dailyAssetTrendObservations}
        reportingExchangeRates={reportingExchangeRates}
        reportingCurrency={reportingCurrency}
        trendRange={trendRange}
        currentDay={currentDay}
        profitColorScheme={profitColorScheme}
        showSensitiveInfo={showSensitiveInfo}
      />
    ) : (
      <>
        <p className="card-label">{card.title}</p>
        <p className="card-body">{card.body}</p>
      </>
    );
  }

  function renderLayoutCard(card: Card, controls: CardDragControls) {
    const source = sourceForCard(card);
    const mobileExpanded = expandedMobileCardIds.has(card.id);
    const cardIndex = visibleCards.findIndex(({ id }) => id === card.id);
    return (
      <article
        ref={controls.cardRef}
        className={`card vibe-data-card span-${card.span}${card.startsNewRow ? " starts-new-row" : ""}${controls.isDragging ? " card-dragging" : ""}${resizingId === card.id ? " card-resizing" : ""}`}
        data-testid="card"
        data-command-target={card.id}
        data-command-label={source ? sourceName(source) : cardName(card)}
        data-layout-card-id={card.id}
        data-mobile-expanded={mobileExpanded ? "true" : "false"}
        data-mobile-layout-mode={mobileLayoutMode ? "true" : "false"}
        data-vibe-surface="data-card"
        tabIndex={-1}
      >
        <CardCornerMarks />
        {mobileLayoutMode ? (
          <div className="mobile-card-sort-row">
            <button
              ref={controls.handleRef}
              type="button"
              className="mobile-card-sort-handle"
              {...controls.handleAttributes}
              {...controls.handleListeners}
              aria-label={`拖动${cardName(card)}调整排序`}
              disabled={controls.disabled}
            >
              <MobileCardIdentity
                card={card}
                source={source}
                cardIndex={cardIndex}
                showSensitiveInfo={showSensitiveInfo}
              />
              <span className="mobile-card-sort-grip" aria-hidden="true" />
            </button>
            <div className="mobile-card-sort-actions">
              <button
                type="button"
                aria-label={`上移${cardName(card)}`}
                disabled={controls.disabled || cardIndex <= 0}
                onClick={() => moveMobileCard(card.id, -1)}
              >
                上移
              </button>
              <button
                type="button"
                aria-label={`下移${cardName(card)}`}
                disabled={
                  controls.disabled ||
                  cardIndex < 0 ||
                  cardIndex >= visibleCards.length - 1
                }
                onClick={() => moveMobileCard(card.id, 1)}
              >
                下移
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="mobile-card-summary"
            aria-expanded={mobileExpanded}
            aria-label={`${mobileExpanded ? "折叠" : "展开"}${cardName(card)}`}
            onClick={() => toggleMobileCard(card.id)}
          >
            <MobileCardIdentity
              card={card}
              source={source}
              cardIndex={cardIndex}
              showSensitiveInfo={showSensitiveInfo}
            />
            {source ? (
              <span
                className="mobile-card-summary-status"
                data-status={
                  source.lifecycle === "disconnected"
                    ? "offline"
                    : source.sync.error
                      ? "error"
                      : source.sync.status
                }
              >
                {source.lifecycle === "disconnected"
                  ? "OFFLINE"
                  : source.sync.error
                    ? "ERROR"
                    : source.sync.status === "expired"
                      ? "STALE"
                      : "CURRENT"}
              </span>
            ) : null}
            <span className="mobile-card-summary-toggle" aria-hidden="true" />
          </button>
        )}
        {renderCardBody(card)}
        <div className="card-actions">
          <span className="source-status">SOURCE / CONTROL</span>
          {source ? (
            <>
              <button type="button" className="text-button" onClick={() => void setSourceHidden(source, true)}>
                隐藏 {sourceName(source)}
              </button>
              <button type="button" className="text-button" onClick={() => openSourceManagement(source)}>
                管理 {sourceName(source)}
              </button>
            </>
          ) : null}
        </div>
        <button
          type="button"
          className="layout-resize-handle"
          data-vibe-component="layout-control"
          aria-label={`调整${cardName(card)}宽度，当前宽度 ${card.span} 格；可拖动或使用左右方向键`}
          disabled={controls.disabled}
          draggable={false}
          onDragStart={(event) => event.preventDefault()}
          onPointerDown={(event) => startResizing(event, card)}
          onPointerMove={moveResizing}
          onPointerUp={finishResizing}
          onLostPointerCapture={finishResizing}
          onPointerCancel={cancelResizing}
          onKeyDown={(event) => resizeFromKeyboard(event, card)}
        />
        <button
          ref={mobileLayoutMode ? undefined : controls.handleRef}
          type="button"
          className="layout-drag-handle"
          data-vibe-component="layout-control"
          {...controls.handleAttributes}
          {...controls.handleListeners}
          aria-label={`拖动${cardName(card)}调整排序`}
          disabled={controls.disabled}
        />
      </article>
    );
  }

  function renderCardPreview(card: Card) {
    const source = sourceForCard(card);
    if (mobileLayoutMode) {
      return (
        <div className="mobile-card-sort-preview">
          <MobileCardIdentity
            card={card}
            source={source}
            cardIndex={visibleCards.findIndex(({ id }) => id === card.id)}
            showSensitiveInfo={showSensitiveInfo}
          />
          <span className="mobile-card-sort-grip" aria-hidden="true" />
        </div>
      );
    }
    return (
      <>
        {renderCardBody(card)}
        <div className="card-actions">
          <span className="source-status">SOURCE / CONTROL</span>
          {source ? (
            <>
              <button type="button" className="text-button" disabled tabIndex={-1}>
                隐藏 {sourceName(source)}
              </button>
              <button type="button" className="text-button" disabled tabIndex={-1}>
                管理 {sourceName(source)}
              </button>
            </>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <>
      {assetSources.length > 0 ? (
        <article
          className="card vibe-data-card total-overview-card"
          data-mobile-expanded={mobileOverviewExpanded ? "true" : "false"}
          data-mobile-layout-mode={mobileLayoutMode ? "true" : "false"}
          data-testid="total-overview-card"
          data-command-target="total-overview"
          data-command-label="总资产概览"
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
            baselines={dailyAssetSnapshots}
            history={dailyAssetTrendObservations}
            currentDay={currentDay}
            showSensitiveInfo={showSensitiveInfo}
          />
          <button
            type="button"
            className="mobile-overview-toggle"
            aria-expanded={mobileOverviewExpanded}
            aria-label={`${mobileOverviewExpanded ? "折叠" : "展开"}总资产详情`}
            onClick={() => setMobileOverviewExpanded((current) => !current)}
          >
            <span>
              {mobileOverviewExpanded ? "收起资产详情" : "查看分布与趋势"}
            </span>
            <span className="mobile-card-summary-toggle" aria-hidden="true" />
          </button>
        </article>
      ) : null}
      <div className="dashboard-control-deck" data-vibe-module="control-deck">
        <div className="owner-toolbar" aria-label="资产管理">
          <VibeButton
            type="button"
            aria-pressed={showSensitiveInfo}
            data-testid="sensitive-info-toggle"
            onClick={() => setShowSensitiveInfo((current) => !current)}
            variant="outline"
          >
            {showSensitiveInfo ? "隐藏关键信息" : "显示关键信息"}
          </VibeButton>
          <AssetSourceFlow />
          <VibeButton
            type="button"
            className="mobile-card-layout-toggle"
            aria-pressed={mobileLayoutMode}
            onPointerUp={(event) => {
              event.preventDefault();
              setMobileLayoutMode((current) => !current);
            }}
            onClick={(event) => {
              if (event.detail === 0) {
                setMobileLayoutMode((current) => !current);
              }
            }}
            variant={mobileLayoutMode ? "primary" : "outline"}
          >
            {mobileLayoutMode ? "完成调整" : "调整卡片顺序"}
          </VibeButton>
        </div>
        <AssetRefreshControls
          enabled={assetSources.some((source) => source.lifecycle !== "disconnected")}
          hasEvmSources={hasEvmSources}
          hasNonEvmSources={hasNonEvmSources}
          needsDailyEvmPriceRefresh={needsDailyEvmPriceRefresh}
        />
      </div>
      {error ? (
        <VibeNotice className="content-error" role="alert" tone="error">
          {error}
        </VibeNotice>
      ) : null}
      <CardLayoutEditor
        cards={displayCards}
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
                <p className="empty-hint">使用上方“添加资产来源”接入只读账户或观察钱包。</p>
              </div>
            ) : null}
          </>
        }
        onCommit={persistLayout}
        onCardsChangedDuringDrag={() => {
          setError("资产来源已变化，请重新调整布局");
        }}
      />
      {hiddenAssetCards.length > 0 ? (
        <section className="hidden-source-management" aria-labelledby="hidden-source-title">
          <h2 id="hidden-source-title">已隐藏的资产来源</h2>
          {hiddenAssetCards.map(({ card, source }) => (
            <div className="card-actions" key={card.id}>
              <span>{sourceName(source)} · 仍在同步并计入总资产</span>
              <button type="button" className="text-button" onClick={() => void setSourceHidden(source, false)}>
                重新显示 {sourceName(source)}
              </button>
              <button type="button" className="text-button" onClick={() => openSourceManagement(source)}>
                管理 {sourceName(source)}
              </button>
            </div>
          ))}
        </section>
      ) : null}
      {managementTarget ? (
        <VibeDialog
          actions={
            <>
              <VibeButton type="button" onClick={closeSourceManagement} variant="text">
                关闭
              </VibeButton>
              <VibeButton
                type="submit"
                disabled={displayNamePending || !displayNameChanged}
                variant="primary"
              >
                保存名称
              </VibeButton>
            </>
          }
          aria-label={`管理 ${sourceName(managementTarget)}`}
          className="source-management-dialog"
          description="仅修改本看板中的显示名称。清空后恢复默认名称。"
          eyebrow="SOURCE / CONTROL"
          headerActions={
            <VibeMenu
              items={[
                ...(managementTarget.lifecycle !== "disconnected"
                  ? [{
                      key: "disconnect",
                      label: "断开来源",
                      onSelect: () => void disconnectSource(managementTarget),
                    }]
                  : []),
                {
                  key: "delete",
                  label: "永久删除数据",
                  tone: "danger" as const,
                  onSelect: () => {
                    setDeleteTarget({ source: managementTarget, stage: 1 });
                    closeSourceManagement();
                  },
                },
              ]}
              label="更多来源操作"
            />
          }
          onClose={closeSourceManagement}
          onSubmit={(event) => {
            event.preventDefault();
            void saveSourceDisplayName(managementTarget);
          }}
          title={sourceName(managementTarget)}
          titleId="source-management-title"
        >
          <VibeField
            autoComplete="off"
            autoFocus
            disabled={displayNamePending}
            fieldId="asset-source-display-name"
            label="自定义名称"
            maxLength={40}
            onChange={(event) => setDisplayNameDraft(event.currentTarget.value)}
            placeholder={assetSourceDefaultDisplayName(managementTarget)}
            value={displayNameDraft}
          />
          {managementTarget.kind.startsWith("evm-watch-") ? (
            <VibeLink
              className="source-management-scope-link"
              href={`/asset-sources/${encodeURIComponent(managementTarget.id)}/settings`}
              variant="outline"
            >
              管理资产范围
            </VibeLink>
          ) : null}
        </VibeDialog>
      ) : null}
      {deleteTarget ? (
        <VibeDialog
          actions={
            <>
              <VibeButton
                type="button"
                disabled={lifecyclePending}
                onClick={() => setDeleteTarget(null)}
                variant="text"
              >
                取消
              </VibeButton>
              {deleteTarget.stage === 1 ? (
                <VibeButton
                  type="button"
                  className="danger-button"
                  onClick={() => setDeleteTarget({ ...deleteTarget, stage: 2 })}
                  variant="outline"
                >
                  继续删除
                </VibeButton>
              ) : (
                <VibeButton
                  type="button"
                  className="danger-button"
                  disabled={lifecyclePending}
                  onClick={() => void permanentlyDeleteSource()}
                  variant="outline"
                >
                  确认永久删除
                </VibeButton>
              )}
            </>
          }
          aria-label={deleteTarget.stage === 1 ? "永久删除来源数据" : "第二次确认永久删除"}
          description={
            deleteTarget.stage === 1
              ? "这会永久删除该来源、持仓记录、同步记录和全部资产快照，且无法恢复。"
              : "最后确认：删除后无法找回任何该来源历史。"
          }
          eyebrow={deleteTarget.stage === 1 ? "PERMANENT DELETE / 01" : "PERMANENT DELETE / 02"}
          onClose={() => setDeleteTarget(null)}
          title={sourceName(deleteTarget.source)}
          titleId="source-delete-title"
        />
      ) : null}
    </>
  );
}
