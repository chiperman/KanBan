"use client";

import { assetSourceDisplayName } from "@/domain/asset-source-display-name";
import { shanghaiDay } from "@/domain/daily-asset-snapshots";
import {
  analyzeInvestmentBook,
  INVESTMENT_BOOKS,
  type BookMember,
  type BookRecord,
  type InvestmentBookId,
  type InvestmentBookState,
} from "@/domain/investment-books";
import {
  DEFAULT_MARKET_BENCHMARK_SYMBOLS,
  type MarketBenchmarkSymbol,
} from "@/domain/market-benchmark";
import type {
  DailyAssetTrendObservation,
  InvestmentCashflow,
  ManualAssetRecord,
} from "@/server/ports";
import { AssetFinancialValue } from "@/ui/asset-financial-value";
import { AssetGlobalRefreshControl } from "@/ui/asset-refresh-controls";
import { bookRequest } from "@/ui/financial-record-requests";
import { useAssetTrendRange } from "@/ui/asset-trend-panel";
import { LongbridgeRealtimeNotice } from "@/ui/longbridge-realtime-notice";
import { useLongbridgeRealtime } from "@/ui/use-longbridge-realtime";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeMenu } from "@/ui/vibe/vibe-menu";
import { useTablePagination } from "@/ui/vibe/vibe-table-pagination";
import { useWorkbenchDisplayPreferences } from "@/ui/workbench-display-preferences";
import { WorkbenchPageHeader } from "@/ui/workbench-page-header";
import { WorkspaceViewNavigation } from "@/ui/workspace-view-navigation";
import { useMemo, useState } from "react";

import { ActionDialog } from "./investment-books/action-dialog";
import { AssetDialog } from "./investment-books/asset-dialog";
import { FundDialog } from "./investment-books/fund-dialog";
import { ImportDialog } from "./investment-books/import-dialog";
import {
  buildBookDepositTotals,
  buildBookRange,
  buildBookTimeline,
} from "./investment-books/model";
import { BookPerformanceView } from "./investment-books/performance-view";
import { BookRecordsView } from "./investment-books/records-view";
import { MemberDialog, ResolveDialog } from "./investment-books/scope-dialogs";
import { bookMoney, labels, type InvestmentBookSource } from "./investment-books/shared";

export { bookMoney, type InvestmentBookSource } from "./investment-books/shared";

export function InvestmentBooksWorkspace({
  state,
  initialBookId = "us-stocks",
  initialRecordFilter = "funds",
  initialRecordDay,
  checkSourceId,
  view = "performance",
  sources,
  observations,
  manualRecords,
  cashflows,
  currentDay,
}: {
  state: InvestmentBookState;
  initialBookId?: InvestmentBookId;
  initialRecordFilter?: "all" | "funds" | "valuations";
  initialRecordDay?: string;
  checkSourceId?: string;
  view?: "performance" | "records";
  sources: InvestmentBookSource[];
  observations: DailyAssetTrendObservation[];
  manualRecords: ManualAssetRecord[];
  cashflows: InvestmentCashflow[];
  currentDay: string;
}) {
  const bookId = initialBookId;
  const [recordFilter, setRecordFilter] = useState(initialRecordFilter);
  const [curve, setCurve] = useState<"return" | "total">("return");
  const [enabledSymbols, setEnabledSymbols] = useState<MarketBenchmarkSymbol[]>([
    ...DEFAULT_MARKET_BENCHMARK_SYMBOLS,
  ]);
  const trendRange = useAssetTrendRange(
    initialRecordDay
      ? { preset: "custom", customRange: { startDay: initialRecordDay, endDay: initialRecordDay } }
      : undefined,
  );
  const checkSource = checkSourceId
    ? sources.find((source) => source.id === checkSourceId && source.kind === "manual")
    : undefined;
  const [dialog, setDialog] = useState<"fund" | "asset" | "import" | null>(null);
  const [assetDay, setAssetDay] = useState<string | undefined>();
  const [editing, setEditing] = useState<BookRecord | null>(null);
  const [voiding, setVoiding] = useState<BookRecord | null>(null);
  const [member, setMember] = useState<BookMember | null>(null);
  const [resolving, setResolving] = useState<InvestmentCashflow | null>(null);
  const { showSensitiveInfo } = useWorkbenchDisplayPreferences();
  const { liveSources, state: realtimeState, retry } = useLongbridgeRealtime(sources);
  const analysis = useMemo(
    () =>
      analyzeInvestmentBook({
        state,
        bookId,
        sources: liveSources,
        observations,
        manualRecords,
        currentDay,
      }),
    [state, bookId, liveSources, observations, manualRecords, currentDay],
  );
  const { preset, customRange } = trendRange;
  const range = useMemo(
    () => buildBookRange({ analysis, currentDay, trendRange: { preset, customRange } }),
    [analysis, currentDay, preset, customRange],
  );
  const { days, selectedDays } = range;
  const depositTotals = useMemo(
    () => buildBookDepositTotals(analysis, state.unassignedLegacyIds.length),
    [analysis, state.unassignedLegacyIds.length],
  );
  const timeline = useMemo(() => buildBookTimeline(analysis), [analysis]);
  const filteredTimeline = useMemo(
    () => timeline.filter(
      (row) =>
        selectedDays.has(row.day) &&
        (recordFilter === "all" ||
          (recordFilter === "valuations" ? row.kind === "valuation" : row.kind !== "valuation")),
    ),
    [timeline, selectedDays, recordFilter],
  );
  const recordPagination = useTablePagination(
    filteredTimeline,
    JSON.stringify([bookId, recordFilter, days[0], days.at(-1)]),
  );
  const pendingMembers = analysis.members.filter((row) => !row.confirmed);
  const unassignedCashflows = cashflows.filter((flow) =>
    state.unassignedLegacyIds.includes(flow.id),
  );
  const bookHref = (id: InvestmentBookId, section = view) =>
    `/performance?book=${id}&view=${section}`;
  return (
    <div className="investment-books">
      <WorkbenchPageHeader
        title="投资账本"
        actions={
          <>
            <AssetGlobalRefreshControl />
            {bookId === "a-shares" ? (
              <VibeMenu
                label="A股记账操作"
                triggerLabel="记账"
                triggerVariant="primary"
                items={[
                  { key: "fund", label: "记录出入金", onSelect: () => setDialog("fund") },
                  { key: "asset", label: "更新A股资产", onSelect: () => setDialog("asset") },
                ]}
              />
            ) : (
              <VibeButton type="button" variant="primary" onClick={() => setDialog("fund")}>
                记录出入金
              </VibeButton>
            )}
          </>
        }
      />
      <div className="investment-books__navigation">
        <WorkspaceViewNavigation
          label="选择投资账本"
          current={bookHref(bookId)}
          items={INVESTMENT_BOOKS.map((book) => ({ href: bookHref(book.id), label: book.name }))}
        />
        <WorkspaceViewNavigation
          label="账本视角"
          current={bookHref(bookId)}
          items={[
            { href: bookHref(bookId, "performance"), label: "收益表现" },
            { href: bookHref(bookId, "records"), label: "记账记录" },
          ]}
        />
      </div>
      {pendingMembers.length > 0 || state.unassignedLegacyIds.length > 0 ? (
        <div className="investment-books__pending">
          {pendingMembers.length > 0 ? (
            <section className="investment-books__pending-card" aria-label="待确认来源范围">
              <h2>来源范围待确认</h2>
              <p className="trend-note">
                确认加入日期后才能汇总自动资产，避免将账户接入误算为收益。
              </p>
              <ul className="manual-asset-history-list">
                {pendingMembers.map((row) => (
                  <li key={row.sourceId}>
                    <span>
                      {sources.find((source) => source.id === row.sourceId)
                        ? assetSourceDisplayName(
                            sources.find((source) => source.id === row.sourceId)!,
                          )
                        : "已移除来源"}
                    </span>
                    <VibeButton
                      type="button"
                      variant="outline"
                      size="compact"
                      onClick={() => setMember(row)}
                    >
                      确认范围
                    </VibeButton>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {state.unassignedLegacyIds.length > 0 ? (
            <section className="investment-books__pending-card" aria-label="旧资金待核对">
              <h2>旧资金待核对</h2>
              <p className="trend-note">
                有 {state.unassignedLegacyIds.length} 笔旧资金需要确认归属，确认前暂停收益计算。
              </p>
              <ul className="manual-asset-history-list">
                {unassignedCashflows.map((flow) => (
                  <li key={flow.id}>
                    <span>{shanghaiDay(flow.occurredAt)}</span>
                    <strong>
                      {showSensitiveInfo ? (
                        <AssetFinancialValue unit={flow.currency}>
                          {bookMoney(flow.amount)}
                        </AssetFinancialValue>
                      ) : (
                        "••••••"
                      )}
                    </strong>
                    <VibeButton
                      type="button"
                      size="compact"
                      variant="outline"
                      onClick={() => setResolving(flow)}
                    >
                      核对归属
                    </VibeButton>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
      <LongbridgeRealtimeNotice
        state={realtimeState}
        retry={retry}
        sourceId={
          sources.find(
            (source) => source.kind === "longbridge" && source.lifecycle !== "disconnected",
          )?.id
        }
      />
      {view === "performance" ? (
        <BookPerformanceView
          {...range}
          analysis={analysis}
          state={state}
          sources={liveSources}
          showSensitiveInfo={showSensitiveInfo}
          enabledSymbols={enabledSymbols}
          setEnabledSymbols={setEnabledSymbols}
          trendRange={trendRange}
          currentDay={currentDay}
          curve={curve}
          setCurve={setCurve}
        />
      ) : null}
      {view === "records" ? (
        <BookRecordsView
          analysis={analysis}
          showSensitiveInfo={showSensitiveInfo}
          checkSourceId={checkSourceId}
          initialRecordDay={initialRecordDay}
          checkSource={checkSource}
          manualRecords={manualRecords}
          recordFilter={recordFilter}
          setRecordFilter={setRecordFilter}
          trendRange={trendRange}
          currentDay={currentDay}
          filteredTimeline={filteredTimeline}
          recordPagination={recordPagination}
          depositTotals={depositTotals}
          setDialog={setDialog}
          setEditing={setEditing}
          setVoiding={setVoiding}
          setAssetDay={setAssetDay}
        />
      ) : null}
      {dialog === "fund" || editing ? (
        <FundDialog
          initialBookId={bookId}
          state={state}
          currentDay={currentDay}
          record={editing ?? undefined}
          onClose={() => {
            setDialog(null);
            setEditing(null);
          }}
        />
      ) : null}
      {dialog === "asset" ? (
        <AssetDialog
          state={state}
          sources={sources}
          manualRecords={manualRecords}
          currentDay={currentDay}
          initialDay={assetDay}
          onClose={() => {
            setDialog(null);
            setAssetDay(undefined);
          }}
        />
      ) : null}
      {dialog === "import" ? (
        <ImportDialog bookId={bookId} onClose={() => setDialog(null)} />
      ) : null}
      {member ? (
        <MemberDialog member={member} currentDay={currentDay} onClose={() => setMember(null)} />
      ) : null}
      {resolving ? (
        <ResolveDialog
          flow={resolving}
          bookId={bookId}
          state={state}
          onClose={() => setResolving(null)}
        />
      ) : null}
      {voiding ? (
        <ActionDialog
          checkBookId={bookId}
          title="作废这条记录？"
          description={
            <>
              {voiding.day}，{labels[voiding.kind]}，
              <AssetFinancialValue unit={voiding.currency}>
                {showSensitiveInfo ? voiding.amount : "••••••"}
              </AssetFinancialValue>
              。作废后重算收益，原件保留。
            </>
          }
          button="确认作废"
          onClose={() => setVoiding(null)}
          submit={(signal) =>
            bookRequest({ action: "void", bookId, id: voiding.id, confirmation: "VOID_RECORD" }, signal)
          }
        >
          {voiding.kind === "opening" ? <p>作废期初本金后，需补齐起点才能重新计算收益。</p> : null}
        </ActionDialog>
      ) : null}
    </div>
  );
}
