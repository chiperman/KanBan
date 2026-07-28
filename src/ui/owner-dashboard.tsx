"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import type { Card, CardSpan, DailyAssetSnapshot } from "@/server/ports";
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
import { TotalAssetOverview } from "@/ui/total-asset-overview";

function cardName(card: Card): string {
  return card.title;
}

function sourceName(source: AssetSourceView): string {
  if (source.kind === "longbridge") return "长桥资产";
  if (source.kind === "binance") return "Binance 资产";
  if (source.kind === "okx") return "OKX 资产";
  if (source.kind === "bitget") return "Bitget 资产";
  if (source.kind === "evm-watch-ethereum") return "Ethereum 观察钱包";
  if (source.kind === "evm-watch-bsc") return "BNB Smart Chain 观察钱包";
  return source.label;
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
  currentDay,
}: {
  cards: Card[];
  assetSources: AssetSourceView[];
  dailyAssetSnapshots: DailyAssetSnapshot[];
  currentDay: string;
}) {
  const [error, setError] = useState("");
  const [showSensitiveInfo, setShowSensitiveInfo] = useState(true);
  const [displayCards, setDisplayCards] = useState(cards);
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
  const [lifecyclePending, setLifecyclePending] = useState(false);

  useEffect(() => {
    setDisplayCards(cards);
  }, [cards]);

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

  function renderCardBody(card: Card) {
    const source = sourceForCard(card);
    return source ? (
      <AssetSourceCard
        source={source}
        history={dailyAssetSnapshots}
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
    return (
      <article
        ref={controls.cardRef}
        className={`card span-${card.span}${card.startsNewRow ? " starts-new-row" : ""}${controls.isDragging ? " card-dragging" : ""}${resizingId === card.id ? " card-resizing" : ""}`}
        data-testid="card"
        data-command-target={card.id}
        data-command-label={source ? sourceName(source) : cardName(card)}
        data-layout-card-id={card.id}
        tabIndex={-1}
      >
        {renderCardBody(card)}
        <div className="card-actions">
          <span className="source-status">SOURCE / CONTROL</span>
          {source ? (
            <>
              <button type="button" className="text-button" onClick={() => void setSourceHidden(source, true)}>
                隐藏 {sourceName(source)}
              </button>
              <button type="button" className="text-button" onClick={() => setManagementTarget(source)}>
                管理 {sourceName(source)}
              </button>
            </>
          ) : null}
        </div>
        <button
          type="button"
          className="layout-resize-handle"
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
          ref={controls.handleRef}
          type="button"
          className="layout-drag-handle"
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
      <div className="dashboard-control-deck">
        <div className="owner-toolbar" aria-label="资产管理">
          <button
            type="button"
            aria-pressed={showSensitiveInfo}
            data-testid="sensitive-info-toggle"
            onClick={() => setShowSensitiveInfo((current) => !current)}
          >
            {showSensitiveInfo ? "隐藏关键信息" : "显示关键信息"}
          </button>
          <AssetSourceFlow />
          <p className="layout-resize-guide">右上角排序 · 右下角调整宽度</p>
        </div>
        <AssetRefreshControls
          enabled={assetSources.some((source) => source.lifecycle !== "disconnected")}
        />
      </div>
      {error ? <p className="content-error" role="alert">{error}</p> : null}
      {assetSources.length > 0 ? (
        <article
          className="card total-overview-card"
          data-testid="total-overview-card"
          data-command-target="total-overview"
          data-command-label="总资产概览"
          tabIndex={-1}
        >
          <TotalAssetOverview
            sources={assetSources}
            history={dailyAssetSnapshots}
            currentDay={currentDay}
            showSensitiveInfo={showSensitiveInfo}
          />
        </article>
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
              <button type="button" className="text-button" onClick={() => setManagementTarget(source)}>
                管理 {sourceName(source)}
              </button>
            </div>
          ))}
        </section>
      ) : null}
      {managementTarget ? (
        <div
          className="editor-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`管理 ${sourceName(managementTarget)}`}
        >
          <div className="editor-dialog source-management-dialog">
            <p className="card-label">来源管理</p>
            <h2>{sourceName(managementTarget)}</h2>
            <p className="login-copy">
              断开会移除只读凭证并停止同步，但保留已有数据；永久删除会清除全部历史。
            </p>
            <div className="editor-actions">
              {managementTarget.lifecycle !== "disconnected" ? (
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => void disconnectSource(managementTarget)}
                >
                  断开 {sourceName(managementTarget)}
                </button>
              ) : null}
              <button
                type="button"
                className="danger-button"
                onClick={() => {
                  setDeleteTarget({ source: managementTarget, stage: 1 });
                  setManagementTarget(null);
                }}
              >
                永久删除 {sourceName(managementTarget)}数据
              </button>
              <button
                type="button"
                className="login-cancel"
                onClick={() => setManagementTarget(null)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {deleteTarget ? (
        <div className="editor-overlay" role="dialog" aria-modal="true" aria-label={deleteTarget.stage === 1 ? "永久删除来源数据" : "第二次确认永久删除"}>
          <div className="editor-dialog">
            <p className="card-label">{deleteTarget.stage === 1 ? "永久删除来源数据" : "第二次确认"}</p>
            <h2>{sourceName(deleteTarget.source)}</h2>
            <p>
              {deleteTarget.stage === 1
                ? "这会永久删除该来源、持仓记录、同步记录和全部资产快照，且无法恢复。"
                : "最后确认：删除后无法找回任何该来源历史。"}
            </p>
            <div className="editor-actions">
              {deleteTarget.stage === 1 ? (
                <button type="button" className="danger-button" onClick={() => setDeleteTarget({ ...deleteTarget, stage: 2 })}>
                  继续删除
                </button>
              ) : (
                <button type="button" className="danger-button" disabled={lifecyclePending} onClick={() => void permanentlyDeleteSource()}>
                  确认永久删除
                </button>
              )}
              <button type="button" className="login-cancel" disabled={lifecyclePending} onClick={() => setDeleteTarget(null)}>
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
