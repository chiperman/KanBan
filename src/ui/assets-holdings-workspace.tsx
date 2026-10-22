"use client";

import { WorkspaceViewNavigation } from "@/ui/workspace-view-navigation";
import { ASSET_VIEWS } from "@/ui/workbench-navigation";
import { Fragment, useId, useMemo, useState, type ReactNode } from "react";

import { assetSourceDisplayName } from "@/domain/asset-source-display-name";
import { longbridgeReferenceRates } from "@/domain/investment-performance";
import {
  decimalCompare,
  decimalToFixed,
} from "@/domain/decimal";
import { activeSourceHoldings } from "@/domain/evm-token-preferences";
import {
  convertCurrencyAmount,
  sourceReportingConversionRates,
  type ReportingCurrency,
} from "@/domain/valuation";
import type {
  AssetHolding,
  AssetSourceSummary,
  ManualAssetRecord,
} from "@/server/ports";
import {
  assetHoldingDisplayName,
  assetHoldingKey,
  AssetHoldingPositionStatus,
} from "@/ui/asset-product-coverage";
import {
  formatAssetAmount,
  formatAssetQuantity,
  formatAssetUnitPrice,
} from "@/ui/asset-price-display";
import { sourceSyncStatus } from "@/ui/asset-source-status";
import { formatShanghaiDateTime } from "@/ui/shanghai-date-time";
import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
import { VibeEntityLink } from "@/ui/vibe/vibe-entity-link";
import {
  VibeField,
  VibeSelect,
  type VibeSelectOption,
} from "@/ui/vibe/vibe-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { VibeStatusTag } from "@/ui/vibe/vibe-data-instrument";
import {
  useWorkbenchDisplayPreferences,
} from "@/ui/workbench-display-preferences";
import { WorkbenchPageHeader } from "@/ui/workbench-page-header";
import { LongbridgeRealtimeNotice, LongbridgeRealtimeStatus } from "@/ui/longbridge-realtime-notice";
import { useLongbridgeRealtime } from "@/ui/use-longbridge-realtime";
import { AssetGlobalRefreshControl } from "@/ui/asset-refresh-controls";
import { CURRENCY_OPTIONS } from "@/ui/reporting-currency-options";
import { useTablePagination, VibeTablePagination } from "@/ui/vibe/vibe-table-pagination";

type WorkspaceSource = Omit<
  AssetSourceSummary,
  "credentialReference" | "permissions"
> & {
  manualRecords: ManualAssetRecord[];
};

type AssetClassFilter = "all" | "securities" | "crypto" | "cash" | "other";
type ValuationFilter = "all" | "valued" | "attention";

type HoldingObservation = {
  holding: AssetHolding;
  source: WorkspaceSource;
};

const ASSET_CLASS_OPTIONS: readonly VibeSelectOption<AssetClassFilter>[] = [
  { value: "all", label: "全部类别" },
  { value: "securities", label: "证券" },
  { value: "crypto", label: "加密资产" },
  { value: "cash", label: "现金" },
  { value: "other", label: "其他" },
];

const VALUATION_OPTIONS: readonly VibeSelectOption<ValuationFilter>[] = [
  { value: "all", label: "全部估值状态" },
  { value: "valued", label: "可估值" },
  { value: "attention", label: "需关注" },
];

function money(value: string): string {
  return formatAssetAmount(value);
}

function signedPercent(value: string): string {
  const comparison = decimalCompare(value, "0");
  return `${comparison > 0 ? "+" : ""}${money(value)}%`;
}

function HoldingValue({ value, unit }: { value: string; unit?: string }) {
  return (
    <>
      <span className="assets-holdings__number asset-financial-number">{value}</span>
      {unit ? <> <span className="vibe-metric__unit">{unit}</span></> : null}
    </>
  );
}

function displayAmount(
  value: string | null,
  fromCurrency: string,
  reportingCurrency: ReportingCurrency,
  rates: WorkspaceSource["snapshot"]["exchangeRates"],
  hidden: boolean,
): ReactNode {
  if (hidden) return "••••••";
  if (value === null) return "数据不足";
  const converted = convertCurrencyAmount(
    value,
    fromCurrency,
    reportingCurrency,
    rates,
  );
  return converted === null
    ? "无法折算"
    : <HoldingValue value={money(converted)} unit={reportingCurrency} />;
}

function displayPrice(
  value: string,
  fromCurrency: string,
  reportingCurrency: ReportingCurrency,
  rates: WorkspaceSource["snapshot"]["exchangeRates"],
  assetClass: AssetHolding["assetClass"],
): ReactNode {
  const converted = convertCurrencyAmount(
    value,
    fromCurrency,
    reportingCurrency,
    rates,
  );
  return converted === null
    ? "无法折算"
    : <HoldingValue value={formatAssetUnitPrice(converted, assetClass)} unit={reportingCurrency} />;
}

function holdingMarketValue(
  holding: AssetHolding,
  reportingCurrency: ReportingCurrency,
  rates: WorkspaceSource["snapshot"]["exchangeRates"],
): string | null {
  const value = holding.sourceMarketValue ??
    (holding.marketValue === null
      ? null
      : { amount: holding.marketValue, currency: holding.currency });
  return value === null
    ? null
    : convertCurrencyAmount(
      value.amount,
      value.currency,
      reportingCurrency,
      rates,
    );
}

function sourceStatuses(source: WorkspaceSource): {
  label: string;
  tone: "warning" | "error";
}[] {
  const statuses: ReturnType<typeof sourceStatuses> = [];
  if (source.kind === "manual" && source.hasManualRecord === false) {
    return [{ label: "尚未添加首条记录", tone: "warning" }];
  }
  if (source.lifecycle === "disconnected") {
    statuses.push({ label: "已断开 · 保留最后快照", tone: "warning" });
  }
  const sync = sourceSyncStatus(source);
  if (sync !== null) statuses.push(sync);
  const coverage = source.snapshot.coverage;
  if (coverage?.status === "unknown") {
    statuses.push({ label: "总额可读 · 覆盖待确认", tone: "warning" });
  } else if (coverage?.status === "partial") {
    statuses.push({
      label: coverage.totalIsAuthoritative
        ? "总额为准 · 明细覆盖不完整"
        : "总额覆盖不完整",
      tone: "warning",
    });
  } else if (
    coverage?.products.some(
      ({ capability, freshness }) =>
        capability === "aggregate-only" && freshness === "current",
    )
  ) {
    statuses.push({ label: "总额完整 · 部分产品仅汇总", tone: "warning" });
  }
  if (coverage?.products.some(({ freshness }) => freshness === "expired")) {
    statuses.push({ label: "含过期产品数据", tone: "warning" });
  }
  if (coverage && coverage.excludedPositiveAccounts.length > 0) {
    statuses.push({ label: "存在未纳入账户", tone: "warning" });
  }
  if (coverage?.unexplainedValue && coverage.status === "complete") {
    statuses.push({ label: "存在明细差额", tone: "warning" });
  }
  return statuses;
}

function holdingStatus(holding: AssetHolding): {
  label: string;
  tone: "success" | "warning" | "error";
} {
  if (holding.valuation.status === "unvalued") {
    return { label: "未估值", tone: "error" };
  }
  if (holding.valuation.status === "quote-unavailable") {
    return { label: "行情不可用", tone: "warning" };
  }
  if (holding.quoteEvidence?.freshness === "retained") {
    return {
      label: holding.quoteEvidence.delivery === "delayed"
        ? "保留行情 · 延迟行情"
        : "保留行情",
      tone: "warning",
    };
  }
  if (holding.quoteEvidence?.delivery === "delayed") {
    return { label: "延迟行情", tone: "warning" };
  }
  return { label: "价格可用", tone: "success" };
}

function priceEvidence(holding: AssetHolding): string {
  if (holding.currentPrice === null) {
    return holding.valuation.status === "unvalued"
      ? holding.valuation.reason
      : "来源未提供可用价格";
  }
  const valuation = holding.valuation.status === "valued"
    ? holding.valuation
    : null;
  const observedAt = holding.quoteEvidence?.quotedAt ??
    holding.quoteEvidence?.observedAt ??
    valuation?.pricedAt;
  return [
    valuation?.priceSource ?? "来源行情",
    holding.quoteEvidence?.delivery === "delayed" ? "延迟行情" : null,
    observedAt ? formatShanghaiDateTime(observedAt) : "时间不可用",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function AssetsHoldingsWorkspace({
  sources,
}: {
  sources: WorkspaceSource[];
}) {
  const {
    currency,
    setCurrency,
    showSensitiveInfo,
  } = useWorkbenchDisplayPreferences();
  const [sourceId, setSourceId] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [assetClass, setAssetClass] = useState<AssetClassFilter>("all");
  const [valuation, setValuation] = useState<ValuationFilter>("all");
  const [expandedEvidenceKeys, setExpandedEvidenceKeys] = useState<string[]>([]);
  const evidencePrefix = useId();
  const { active: realtimeActive, liveSources, state: realtimeState, retry } = useLongbridgeRealtime(sources);

  const recordedSources = useMemo(
    () =>
      liveSources.filter(
        (source) => source.kind !== "manual" || source.hasManualRecord !== false,
      ),
    [liveSources],
  );
  const reportingRates = useMemo(
    () => longbridgeReferenceRates(recordedSources),
    [recordedSources],
  );

  const sourceOptions = useMemo<readonly VibeSelectOption<string>[]>(
    () => [
      { value: "all", label: "全部来源" },
      ...liveSources.map((source) => ({
        value: source.id,
        label: assetSourceDisplayName(source),
      })),
    ],
    [liveSources],
  );
  const observations = useMemo<HoldingObservation[]>(
    () =>
      liveSources.flatMap((source) =>
        source.kind === "manual"
          ? []
          : activeSourceHoldings(source).map((holding) => ({ holding, source })),
      ),
    [liveSources],
  );
  const filteredObservations = useMemo(
    () =>
      observations
        .filter(({ holding, source }) => {
          const query = searchQuery.trim().toLocaleLowerCase();
          return query === "" || [
            source.label, source.displayName, assetHoldingDisplayName(holding),
            holding.symbol, holding.sourceAsset, holding.sourceAccount, holding.sourceProduct,
          ].some((value) => value?.toLocaleLowerCase().includes(query));
        })
        .filter((item) => sourceId === "all" || item.source.id === sourceId)
        .filter(
          (item) =>
            assetClass === "all" || item.holding.assetClass === assetClass,
        )
        .filter((item) => {
          if (valuation === "all") return true;
          const needsAttention =
            item.holding.valuation.status !== "valued" ||
            item.holding.quoteEvidence?.freshness === "retained";
          return valuation === "attention" ? needsAttention : !needsAttention;
        })
        .toSorted((left, right) => {
          const leftValue = holdingMarketValue(
            left.holding,
            currency,
            sourceReportingConversionRates(left.source, reportingRates),
          );
          const rightValue = holdingMarketValue(
            right.holding,
            currency,
            sourceReportingConversionRates(right.source, reportingRates),
          );
          if (leftValue === null) return rightValue === null ? 0 : 1;
          if (rightValue === null) return -1;
          return decimalCompare(rightValue, leftValue);
        }),
    [
      assetClass,
      currency,
      observations,
      reportingRates,
      searchQuery,
      sourceId,
      valuation,
    ],
  );

  const holdingsPagination = useTablePagination(filteredObservations, JSON.stringify([sourceId, searchQuery, assetClass, valuation]));

  return (
    <section
      className="assets-holdings"
      data-testid="assets-holdings-workspace"
      aria-labelledby="assets-holdings-title"
    >
      <WorkbenchPageHeader
        description={realtimeActive ? <LongbridgeRealtimeStatus state={realtimeState} /> : undefined}
        actions={
          <>
          <VibeSelect
            fieldId="assets-reporting-currency"
            label="计价货币"
            onValueChange={setCurrency}
            options={CURRENCY_OPTIONS}
            value={currency}
            variant="compact"
          />
          <AssetGlobalRefreshControl />
          <VibeLink href="/asset-sources/new" variant="primary">新增来源</VibeLink>
          </>
        }
        eyebrow="PORTFOLIO / HOLDINGS"
        title="资产"
        titleId="assets-holdings-title"
      />

      <WorkspaceViewNavigation label="资产视角" items={ASSET_VIEWS} current="/assets" />
      <LongbridgeRealtimeNotice state={realtimeState} retry={retry} />

      <section
        className="assets-holdings__observations"
        aria-labelledby="holding-observations-title"
      >
        <header>
          <div>
            <p className="card-label">HOLDINGS / OBSERVATION</p>
            <h2 id="holding-observations-title">持仓价格与市值观察</h2>
          </div>
          <p className="assets-holdings__count" data-testid="assets-holdings-count">
            显示 {filteredObservations.length} 项观察
          </p>
        </header>

        <div className="assets-holdings__filters" aria-label="持仓筛选">
          <VibeField
            fieldId="assets-holdings-search"
            label="搜索全部持仓"
            onChange={(event) => setSearchQuery(event.target.value)}
            type="search"
            value={searchQuery}
          />
          <VibeSelect
            fieldId="assets-source-filter"
            label="资产来源"
            onValueChange={setSourceId}
            options={sourceOptions}
            value={sourceId}
            variant="compact"
          />
          <VibeSelect
            fieldId="assets-class-filter"
            label="资产类别"
            onValueChange={(value) => setAssetClass(value as AssetClassFilter)}
            options={ASSET_CLASS_OPTIONS}
            value={assetClass}
            variant="compact"
          />
          <VibeSelect
            fieldId="assets-valuation-filter"
            label="估值状态"
            onValueChange={(value) => setValuation(value as ValuationFilter)}
            options={VALUATION_OPTIONS}
            value={valuation}
            variant="compact"
          />
        </div>

        {filteredObservations.length === 0 ? (
          <div className="empty-state" data-testid="assets-holdings-empty">
            <p className="empty-title">无匹配持仓</p>
          </div>
        ) : (
          <div className="assets-holdings__table-wrap">
            <table data-testid="assets-holdings-table">
              <thead>
                <tr>
                  <th scope="col">资产与来源</th>
                  <th scope="col">市值</th>
                  <th scope="col">现价 / 数量</th>
                  <th scope="col">价格变化</th>
                  <th scope="col">平台盈亏</th>
                  <th scope="col">数据状态</th>
                </tr>
              </thead>
              <tbody>
                {holdingsPagination.visibleItems.map(({ holding, source }) => {
                  const sourceRates = sourceReportingConversionRates(
                    source,
                    reportingRates,
                  );
                  const marketValue = holdingMarketValue(
                    holding,
                    currency,
                    sourceRates,
                  );
                  const showSourceMarketValue =
                    showSensitiveInfo && holding.sourceMarketValue !== null &&
                    holding.sourceMarketValue !== undefined && (
                      holding.sourceMarketValue.currency !== currency ||
                      marketValue === null ||
                      money(holding.sourceMarketValue.amount) !== money(marketValue)
                    );
                  const status = holdingStatus(holding);
                  const platformProfit = displayAmount(
                    holding.platformProfit,
                    holding.currency,
                    currency,
                    sourceRates,
                    !showSensitiveInfo,
                  );
                  const observationKey = `${source.id}:${assetHoldingKey(holding)}`;
                  const evidenceId = `${evidencePrefix}-${encodeURIComponent(observationKey)}`;
                  const isEvidenceOpen = expandedEvidenceKeys.includes(observationKey);
                  return (
                    <Fragment key={observationKey}>
                      <tr
                        className={
                          holding.valuation.status === "unvalued"
                            ? "is-unvalued"
                            : undefined
                        }
                      >
                        <td data-label="资产与来源">
                          <strong>{assetHoldingDisplayName(holding)}</strong>
                          <AssetHoldingPositionStatus holding={holding} />
                          <div className="assets-holdings__asset-meta">
                            <VibeEntityLink href={`/asset-sources/${encodeURIComponent(source.id)}`} aria-label={`查看 ${assetSourceDisplayName(source)} 来源详情`}>
                              {assetSourceDisplayName(source)}
                            </VibeEntityLink>
                            <small>{holding.sourceProduct ?? ASSET_CLASS_OPTIONS.find(({ value }) => value === holding.assetClass)?.label ?? holding.assetClass}</small>
                          </div>
                        </td>
                        <td data-label="市值">
                          <strong>
                            {showSensitiveInfo
                              ? marketValue === null
                                ? holding.valuation.status === "unvalued"
                                  ? "未估值"
                                  : "数据不足"
                                : <HoldingValue value={money(marketValue)} unit={currency} />
                              : "••••••"}
                          </strong>
                          {showSourceMarketValue && holding.sourceMarketValue ? (
                            <span>
                              原币 <HoldingValue
                                value={formatAssetAmount(holding.sourceMarketValue.amount)}
                                unit={holding.sourceMarketValue.currency}
                              />
                            </span>
                          ) : holding.sourceMarketValue ? null : (
                            <span>原市值缺失</span>
                          )}
                        </td>
                        <td data-label="现价 / 数量">
                          <strong>
                            {showSensitiveInfo
                              ? holding.currentPrice
                                ? displayPrice(
                                  holding.currentPrice.amount,
                                  holding.currentPrice.currency,
                                  currency,
                                  sourceRates,
                                  holding.assetClass,
                                )
                                : "现价不可用"
                              : "••••••"}
                          </strong>
                          <div className="assets-holdings__price-meta">
                            <span>
                              {showSensitiveInfo
                                ? `${formatAssetQuantity(holding.quantity)} ${holding.symbol}`
                                : "••••••"}
                            </span>
                          </div>
                        </td>
                        <td data-label="价格变化">
                          <strong>
                            {holding.changePercent === null
                              ? "数据不足"
                              : showSensitiveInfo
                                ? <HoldingValue value={signedPercent(holding.changePercent)} />
                                : "••••••"}
                          </strong>
                        </td>
                        <td data-label="平台盈亏">
                          <strong>
                            {showSensitiveInfo && holding.platformProfit === null
                              ? "平台未提供"
                              : platformProfit}
                          </strong>
                        </td>
                        <td data-label="数据状态">
                          <div className="assets-holdings__status">
                            <VibeStatusTag tone={status.tone}>{status.label}</VibeStatusTag>
                            <VibeButton
                              aria-controls={evidenceId}
                              aria-expanded={isEvidenceOpen}
                              aria-label={`${isEvidenceOpen ? "收起" : "查看"} ${assetHoldingDisplayName(holding)} 行情依据`}
                              onClick={() => setExpandedEvidenceKeys((keys) =>
                                keys.includes(observationKey)
                                  ? keys.filter((key) => key !== observationKey)
                                  : [...keys, observationKey]
                              )}
                              type="button"
                              variant="text"
                              size="compact"
                            >
                              {isEvidenceOpen ? "收起依据" : "行情依据"}
                            </VibeButton>
                          </div>
                        </td>
                      </tr>
                      {isEvidenceOpen ? (
                        <tr className="assets-holdings__evidence-row">
                          <td colSpan={6}>
                            <div className="assets-holdings__price-evidence" id={evidenceId}>
                              <span>{assetHoldingDisplayName(holding)} · 行情依据</span>
                              <p>{priceEvidence(holding)}</p>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <VibeTablePagination label="资产持仓分页" pagination={holdingsPagination.controls} />

        <VibeNotice tone="info">
          价格变化采用来源可用行情；平台盈亏沿用平台原生口径。
        </VibeNotice>
      </section>

    </section>
  );
}
