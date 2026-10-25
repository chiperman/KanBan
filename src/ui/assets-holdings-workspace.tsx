"use client";

import { Fragment, useId, useMemo, useState, type ReactNode } from "react";

import { assetSourceDisplayName } from "@/domain/asset-source-display-name";
import { longbridgeReferenceRates } from "@/domain/investment-performance";
import {
  decimalCompare,
  decimalMultiply,
  decimalSubtract,
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
import { holdingTodayProfit } from "@/ui/asset-source-card/holding-detail-model";
import { profitDirection, type ProfitColorScheme } from "@/ui/profit-color-scheme";
import { signedAmount } from "@/ui/signed-amount";
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

type WorkspaceSource = Omit<
  AssetSourceSummary,
  "credentialReference" | "permissions"
> & {
  hidden?: boolean;
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

function holdingFloatingProfit(holding: AssetHolding): string | null {
  if (
    holding.currentPrice === null ||
    holding.costPrice === null ||
    holding.currentPrice.currency !== holding.currency
  ) {
    return null;
  }
  return decimalMultiply(
    decimalSubtract(holding.currentPrice.amount, holding.costPrice),
    holding.quantity,
  );
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

function holdingStatus(holding: AssetHolding): {
  label: string;
  tone: "success" | "warning" | "error" | "muted";
} {
  if (holding.valuation.status === "unvalued") {
    return { label: "未估值", tone: "error" };
  }
  if (holding.valuation.status === "quote-unavailable") {
    return { label: "持仓行情未接入", tone: "muted" };
  }
  if (holding.quoteEvidence?.freshness === "retained") {
    return {
      label: holding.quoteEvidence.delivery === "delayed"
        ? "保留行情，延迟行情"
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
    .join("，");
}

export function AssetsHoldingsWorkspace({
  sources,
  profitColorScheme,
}: {
  sources: WorkspaceSource[];
  profitColorScheme: ProfitColorScheme;
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
  const { active: realtimeActive, liveSources, state: realtimeState, retry } = useLongbridgeRealtime(
    sources, true, { immediateInitialQuotes: true },
  );
  const selectedSource = liveSources.find((source) => source.id === sourceId);

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
        title="资产"
        titleId="assets-holdings-title"
      />

      <LongbridgeRealtimeNotice state={realtimeState} retry={retry} sourceId={sources.find(source => source.kind === "longbridge" && source.lifecycle !== "disconnected")?.id} />

      <section
        className="assets-holdings__observations"
        id="asset-sources"
        aria-labelledby="holding-observations-title"
      >
        <header>
          <div>
            <h2 id="holding-observations-title">持仓</h2>
          </div>
          <p className="assets-holdings__count" data-testid="assets-holdings-count">
            {filteredObservations.length} 项
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
          {selectedSource ? (
            <div className="assets-holdings__source-access">
              <VibeEntityLink
                href={`/asset-sources/${encodeURIComponent(selectedSource.id)}`}
                aria-label={`查看 ${assetSourceDisplayName(selectedSource)} 来源详情`}
              >
                {assetSourceDisplayName(selectedSource)}
              </VibeEntityLink>
            </div>
          ) : null}
        </div>

        {filteredObservations.length === 0 ? (
          <div className="empty-state" data-testid="assets-holdings-empty">
            <p className="empty-title">{observations.length === 0 ? "暂无持仓" : "无匹配持仓"}</p>
            {sourceId !== "all" || searchQuery || assetClass !== "all" || valuation !== "all" ? (
              <VibeButton type="button" variant="outline" onClick={() => { setSourceId("all"); setSearchQuery(""); setAssetClass("all"); setValuation("all"); }}>清除筛选</VibeButton>
            ) : liveSources.length === 0 ? <VibeLink href="/asset-sources/new" variant="primary">新增来源</VibeLink> : null}
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
                  <th scope="col">持仓浮盈亏</th>
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
                  const priceChange = holding.changePercent ?? holdingTodayProfit(holding)?.percent ?? null;
                  const floatingProfit = holdingFloatingProfit(holding);
                  const convertedProfit = floatingProfit === null ? null : convertCurrencyAmount(
                    floatingProfit, holding.currency, currency, sourceRates,
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
                              : <HoldingValue value="••••••" />}
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
                              : <HoldingValue value="••••••" />}
                          </strong>
                          <div className="assets-holdings__price-meta">
                            <span>
                              {showSensitiveInfo
                                ? `${formatAssetQuantity(holding.quantity)} ${holding.symbol}`
                                : <HoldingValue value="••••••" />}
                            </span>
                          </div>
                        </td>
                        <td data-label="价格变化">
                          <strong
                            className="profit-color-value"
                            data-profit-color-scheme={profitColorScheme}
                            data-profit-direction={showSensitiveInfo && priceChange !== null
                              ? profitDirection(priceChange) : "neutral"}
                          >
                            {showSensitiveInfo
                              ? priceChange === null
                                ? "数据不足"
                                : <HoldingValue value={signedPercent(priceChange)} />
                              : <HoldingValue value="••••••" />}
                          </strong>
                        </td>
                        <td data-label="持仓浮盈亏">
                          <strong
                            className="profit-color-value"
                            data-profit-color-scheme={profitColorScheme}
                            data-profit-direction={showSensitiveInfo && convertedProfit !== null
                              ? profitDirection(convertedProfit) : "neutral"}
                          >
                            {showSensitiveInfo
                              ? floatingProfit === null
                                ? "数据不足"
                                : convertedProfit === null
                                  ? "无法折算"
                                  : <HoldingValue value={signedAmount(convertedProfit, money)} unit={currency} />
                              : <HoldingValue value="••••••" />}
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
                              <span>{assetHoldingDisplayName(holding)}，行情依据</span>
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

        <VibeNotice tone="info">
          价格变化采用来源可用行情；持仓浮盈亏按现价、成本与数量计算。
        </VibeNotice>
      </section>

    </section>
  );
}
