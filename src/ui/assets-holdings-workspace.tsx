"use client";

import { useId, useMemo, useState } from "react";

import { assetSourceDisplayName } from "@/domain/asset-source-display-name";
import { longbridgeReferenceRates } from "@/domain/investment-performance";
import {
  decimalCompare,
  decimalToFixed,
} from "@/domain/decimal";
import { activeSourceHoldings, portfolioSourceTotal } from "@/domain/evm-token-preferences";
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
import { formatAssetUnitPrice } from "@/ui/asset-price-display";
import { sourceSyncStatus } from "@/ui/asset-source-status";
import { formatShanghaiDateTime } from "@/ui/shanghai-date-time";
import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
import {
  VibeSelect,
  type VibeSelectOption,
} from "@/ui/vibe/vibe-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { VibeMetric, VibeStatusTag } from "@/ui/vibe/vibe-data-instrument";
import {
  useWorkbenchDisplayPreferences,
} from "@/ui/workbench-display-preferences";
import { WorkbenchPageHeader } from "@/ui/workbench-page-header";
import { LongbridgeRealtimeNotice, LongbridgeRealtimeStatus } from "@/ui/longbridge-realtime-notice";
import { useLongbridgeRealtime } from "@/ui/use-longbridge-realtime";
import { AssetGlobalRefreshControl } from "@/ui/asset-refresh-controls";

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

const CURRENCY_OPTIONS: readonly VibeSelectOption<ReportingCurrency>[] = [
  { value: "USD", label: "USD" },
  { value: "CNY", label: "CNY" },
  { value: "HKD", label: "HKD" },
];

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
  const [integer, fraction] = decimalToFixed(value, 2).split(".");
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

function signedPercent(value: string): string {
  const comparison = decimalCompare(value, "0");
  return `${comparison > 0 ? "+" : ""}${money(value)}%`;
}

function displayAmount(
  value: string | null,
  fromCurrency: string,
  reportingCurrency: ReportingCurrency,
  rates: WorkspaceSource["snapshot"]["exchangeRates"],
  hidden: boolean,
): string {
  if (hidden) return "••••••";
  if (value === null) return "数据不足";
  const converted = convertCurrencyAmount(
    value,
    fromCurrency,
    reportingCurrency,
    rates,
  );
  return converted === null ? "无法折算" : `${money(converted)} ${reportingCurrency}`;
}

function displayPrice(
  value: string,
  fromCurrency: string,
  reportingCurrency: ReportingCurrency,
  rates: WorkspaceSource["snapshot"]["exchangeRates"],
  assetClass: AssetHolding["assetClass"],
): string {
  const converted = convertCurrencyAmount(
    value,
    fromCurrency,
    reportingCurrency,
    rates,
  );
  return converted === null
    ? "无法折算"
    : `${formatAssetUnitPrice(converted, assetClass)} ${reportingCurrency}`;
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

function HoldingPriceEvidence({ holding }: { holding: AssetHolding }) {
  const [isOpen, setIsOpen] = useState(false);
  const evidenceId = useId();
  return (
    <div className="assets-holdings__price-evidence">
      <VibeButton
        aria-controls={evidenceId}
        aria-expanded={isOpen}
        aria-label={`查看 ${assetHoldingDisplayName(holding)} 行情依据`}
        onClick={() => setIsOpen(!isOpen)}
        type="button"
        variant="text"
      >
        {isOpen ? "收起行情依据" : "行情依据"}
      </VibeButton>
      {isOpen ? <small id={evidenceId}>{priceEvidence(holding)}</small> : null}
    </div>
  );
}

function sourceTotal(
  source: WorkspaceSource,
  currency: ReportingCurrency,
  rates: WorkspaceSource["snapshot"]["exchangeRates"],
): string | null {
  const total = portfolioSourceTotal(source);
  return convertCurrencyAmount(total.amount, total.currency, currency, rates);
}

function AssetSourceTotalRow({
  currency,
  reportingRates,
  showSensitiveInfo,
  source,
}: {
  currency: ReportingCurrency;
  reportingRates: WorkspaceSource["snapshot"]["exchangeRates"];
  showSensitiveInfo: boolean;
  source: WorkspaceSource;
}) {
  const sourceRates = sourceReportingConversionRates(source, reportingRates);
  const total = sourceTotal(source, currency, sourceRates);
  const statuses = sourceStatuses(source);
  const manualWithoutRecord =
    source.kind === "manual" && source.hasManualRecord === false;

  return (
    <li
      data-testid={`assets-source-total-${source.id}`}
    >
      <article>
        <div>
          <VibeLink
            aria-label={`查看 ${assetSourceDisplayName(source)} 来源详情`}
            className="assets-holdings__source-name"
            href={`/asset-sources/${encodeURIComponent(source.id)}`}
            variant="text"
          >
            <strong>{assetSourceDisplayName(source)}</strong>
          </VibeLink>
          {statuses.length > 0 ? (
            <div className="assets-holdings__source-state">
              {statuses.map((status) => (
                <VibeStatusTag key={status.label} tone={status.tone}>
                  {status.label}
                </VibeStatusTag>
              ))}
            </div>
          ) : null}
        </div>
        <div className="assets-holdings__source-value">
          {showSensitiveInfo && total !== null && !manualWithoutRecord ? (
            <VibeMetric
              animationKey={source.kind === "longbridge" ? source.snapshot.syncedAt : undefined}
              unit={currency}
              value={money(total)}
            />
          ) : (
            <strong
              className={
                showSensitiveInfo
                  ? undefined
                  : "assets-holdings__source-value-hidden"
              }
            >
              {showSensitiveInfo
                ? manualWithoutRecord ? "尚无记录" : "无法折算"
                : "金额已隐藏"}
            </strong>
          )}
        </div>
      </article>
    </li>
  );
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
  const [assetClass, setAssetClass] = useState<AssetClassFilter>("all");
  const [valuation, setValuation] = useState<ValuationFilter>("all");
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
      sourceId,
      valuation,
    ],
  );

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
          </>
        }
        eyebrow="PORTFOLIO / HOLDINGS"
        title="资产与持仓"
        titleId="assets-holdings-title"
      />

      <LongbridgeRealtimeNotice state={realtimeState} retry={retry} />

      <section
        className="assets-holdings__source-totals"
        aria-labelledby="assets-source-totals-title"
      >
        <header>
          <div>
            <p className="card-label">SOURCE / TRUTH</p>
            <h2 id="assets-source-totals-title">来源账户与平台总额</h2>
          </div>
        </header>
        {liveSources.length === 0 ? (
          <div className="empty-state">
            <p className="empty-title">尚未接入资产来源</p>
            <VibeLink href="/asset-sources/new" variant="outline">
              新增来源
            </VibeLink>
          </div>
        ) : (
          <div
            className="assets-holdings__source-list"
            data-testid="assets-source-totals"
          >
            <div
              aria-hidden="true"
              className="assets-holdings__source-columns"
            >
              <span>来源</span>
              <span>来源总额</span>
            </div>
            <ol>
              {liveSources.map((source) => (
                <AssetSourceTotalRow
                  currency={currency}
                  key={source.id}
                  reportingRates={reportingRates}
                  showSensitiveInfo={showSensitiveInfo}
                  source={source}
                />
              ))}
            </ol>
          </div>
        )}
      </section>

      <section
        className="assets-holdings__observations"
        aria-labelledby="holding-observations-title"
      >
        <header>
          <div>
            <p className="card-label">HOLDINGS / OBSERVATION</p>
            <h2 id="holding-observations-title">持仓价格与市值观察</h2>
          </div>
          <VibeLink href="/asset-sources" variant="text">
            管理资产来源
          </VibeLink>
        </header>

        <div className="assets-holdings__filters" aria-label="持仓筛选">
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
          <p data-testid="assets-holdings-count">
            显示 {filteredObservations.length} 项观察
          </p>
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
                {filteredObservations.map(({ holding, source }) => {
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
                  return (
                    <tr
                      key={`${source.id}:${assetHoldingKey(holding)}`}
                      className={
                        holding.valuation.status === "unvalued"
                          ? "is-unvalued"
                          : undefined
                      }
                    >
                      <td data-label="资产与来源">
                        <strong>{assetHoldingDisplayName(holding)}</strong>
                        <AssetHoldingPositionStatus holding={holding} />
                        <span>{assetSourceDisplayName(source)}</span>
                        <small>{holding.sourceProduct ?? holding.assetClass}</small>
                      </td>
                      <td data-label="市值">
                        <strong>
                          {showSensitiveInfo
                            ? marketValue === null
                              ? holding.valuation.status === "unvalued"
                                ? "未估值"
                                : "数据不足"
                              : `${money(marketValue)} ${currency}`
                            : "••••••"}
                        </strong>
                        {showSourceMarketValue && holding.sourceMarketValue ? (
                          <span>
                            原币 {money(holding.sourceMarketValue.amount)} {holding.sourceMarketValue.currency}
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
                        <span>
                          {showSensitiveInfo
                            ? `${holding.quantity} ${holding.symbol}`
                            : "••••••"}
                        </span>
                        <HoldingPriceEvidence holding={holding} />
                      </td>
                      <td data-label="价格变化">
                        <strong>
                          {holding.changePercent === null
                            ? "数据不足"
                            : showSensitiveInfo
                              ? signedPercent(holding.changePercent)
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
                        <VibeStatusTag tone={status.tone}>{status.label}</VibeStatusTag>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <VibeNotice tone="info">
          价格变化采用来源可用行情；平台盈亏沿用平台原生口径。
        </VibeNotice>
      </section>
    </section>
  );
}
