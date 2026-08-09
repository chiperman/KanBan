"use client";

import { useMemo, useState } from "react";

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
  AssetProductCoverage,
} from "@/ui/asset-product-coverage";
import { formatShanghaiDateTime } from "@/ui/shanghai-date-time";
import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
import {
  VibeSelect,
  type VibeSelectOption,
} from "@/ui/vibe/vibe-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { VibeMetric, VibeStatusTag } from "@/ui/vibe/vibe-data-instrument";

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

function sourceStatus(source: WorkspaceSource): {
  label: string;
  tone: "success" | "warning" | "error";
} {
  if (source.lifecycle === "disconnected") {
    return { label: "已断开 · 保留最后快照", tone: "warning" };
  }
  if (source.sync.error !== null) {
    return { label: "同步失败 · 保留最后成功数据", tone: "error" };
  }
  if (source.sync.status === "expired") {
    return { label: "数据过期 · 可手动刷新", tone: "warning" };
  }
  if (source.snapshot.coverage?.status === "unknown") {
    return { label: "总额可读 · 覆盖待确认", tone: "warning" };
  }
  if (source.snapshot.coverage?.status === "partial") {
    return source.snapshot.coverage.totalIsAuthoritative
      ? { label: "总额为准 · 明细覆盖不完整", tone: "warning" }
      : { label: "总额覆盖不完整", tone: "warning" };
  }
  return { label: "当前来源总额", tone: "success" };
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
    return { label: "保留行情", tone: "warning" };
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

function sourceHoldingCount(source: WorkspaceSource): number {
  return source.kind === "manual"
    ? 0
    : activeSourceHoldings(source).length;
}

function sourceTotal(
  source: WorkspaceSource,
  currency: ReportingCurrency,
  rates: WorkspaceSource["snapshot"]["exchangeRates"],
): string | null {
  const total = portfolioSourceTotal(source);
  return convertCurrencyAmount(total.amount, total.currency, currency, rates);
}

export function AssetsHoldingsWorkspace({
  sources,
}: {
  sources: WorkspaceSource[];
}) {
  const [currency, setCurrency] = useState<ReportingCurrency>("USD");
  const [sourceId, setSourceId] = useState("all");
  const [assetClass, setAssetClass] = useState<AssetClassFilter>("all");
  const [valuation, setValuation] = useState<ValuationFilter>("all");
  const [showSensitiveInfo, setShowSensitiveInfo] = useState(true);

  const recordedSources = useMemo(
    () =>
      sources.filter(
        (source) => source.kind !== "manual" || source.hasManualRecord !== false,
      ),
    [sources],
  );
  const reportingRates = useMemo(
    () => longbridgeReferenceRates(recordedSources),
    [recordedSources],
  );
  const sourceOptions = useMemo<readonly VibeSelectOption<string>[]>(
    () => [
      { value: "all", label: "全部来源" },
      ...sources.map((source) => ({
        value: source.id,
        label: assetSourceDisplayName(source),
      })),
    ],
    [sources],
  );
  const observations = useMemo<HoldingObservation[]>(
    () =>
      sources.flatMap((source) =>
        source.kind === "manual"
          ? []
          : activeSourceHoldings(source).map((holding) => ({ holding, source })),
      ),
    [sources],
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
      <header className="assets-holdings__header">
        <div>
          <p className="card-label">PORTFOLIO / HOLDINGS</p>
          <h1 id="assets-holdings-title">资产与持仓</h1>
          <p>
            账户或平台返回的来源总额是组合汇总真相；下方持仓仅作价格与市值观察，不以明细合计改写来源总额。
          </p>
        </div>
        <div className="assets-holdings__actions">
          <VibeSelect
            fieldId="assets-reporting-currency"
            label="计价货币"
            onValueChange={(value) => setCurrency(value as ReportingCurrency)}
            options={CURRENCY_OPTIONS}
            value={currency}
            variant="compact"
          />
          <VibeButton
            aria-pressed={showSensitiveInfo}
            onClick={() => setShowSensitiveInfo((current) => !current)}
            type="button"
            variant="outline"
          >
            {showSensitiveInfo ? "隐藏关键信息" : "显示关键信息"}
          </VibeButton>
        </div>
      </header>

      <section
        className="assets-holdings__source-totals"
        aria-labelledby="assets-source-totals-title"
      >
        <header>
          <div>
            <p className="card-label">SOURCE / TRUTH</p>
            <h2 id="assets-source-totals-title">来源账户与平台总额</h2>
          </div>
          <span>持仓明细不会取代这一列</span>
        </header>
        {sources.length === 0 ? (
          <div className="empty-state">
            <p className="empty-title">尚未接入资产来源</p>
            <p className="empty-hint">
              先添加只读来源或手工资产组；连接后可在这里分别阅读总额与持仓观察。
            </p>
            <VibeLink href="/asset-sources/new" variant="outline">
              新增来源
            </VibeLink>
          </div>
        ) : (
          <ol data-testid="assets-source-totals">
            {sources.map((source) => {
              const sourceRates = sourceReportingConversionRates(
                source,
                reportingRates,
              );
              const total = sourceTotal(source, currency, sourceRates);
              const status = sourceStatus(source);
              const coverage = source.snapshot.coverage;
              return (
                <li key={source.id} data-testid={`assets-source-total-${source.id}`}>
                  <article>
                    <div>
                      <strong>{assetSourceDisplayName(source)}</strong>
                      <span>
                        {source.kind === "manual"
                          ? source.hasManualRecord === false
                            ? "手工资产组 · 暂无记录"
                            : "手工资产组 · 仅总额"
                          : `${sourceHoldingCount(source)} 项持仓观察`}
                      </span>
                    </div>
                    <div className="assets-holdings__source-state">
                      <VibeStatusTag tone={status.tone}>{status.label}</VibeStatusTag>
                      {coverage ? (
                        <AssetProductCoverage
                          coverage={coverage}
                          sourceKind={`assets-${source.id}`}
                        />
                      ) : null}
                    </div>
                    <div className="assets-holdings__source-value">
                      {showSensitiveInfo && total !== null ? (
                        <VibeMetric unit={currency} value={money(total)} />
                      ) : (
                        <strong>
                          {showSensitiveInfo ? "无法折算" : "••••••"}
                        </strong>
                      )}
                      <VibeLink
                        aria-label={`查看 ${assetSourceDisplayName(source)} 来源详情`}
                        href={`/asset-sources/${encodeURIComponent(source.id)}`}
                        variant="text"
                      >
                        详情
                      </VibeLink>
                    </div>
                  </article>
                </li>
              );
            })}
          </ol>
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
            <p>
              平台未提供成本、累计盈亏或完整价格端点时，明确显示数据不足，不推测或补零。
            </p>
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
            <p className="empty-title">当前筛选没有持仓观察</p>
            <p className="empty-hint">
              手工资产组与仅汇总产品仍会保留在上方来源总额中，不会伪造成单项持仓。
            </p>
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
                        <span>
                          {holding.sourceMarketValue
                            ? `来源口径 ${money(holding.sourceMarketValue.amount)} ${holding.sourceMarketValue.currency}`
                            : "来源市值不可用"}
                        </span>
                      </td>
                      <td data-label="现价 / 数量">
                        <strong>
                          {showSensitiveInfo
                            ? holding.currentPrice
                              ? displayAmount(
                                holding.currentPrice.amount,
                                holding.currentPrice.currency,
                                currency,
                                sourceRates,
                                false,
                              )
                              : "现价不可用"
                            : "••••••"}
                        </strong>
                        <span>
                          {showSensitiveInfo
                            ? `${holding.quantity} ${holding.symbol}`
                            : "••••••"}
                        </span>
                        <small>{priceEvidence(holding)}</small>
                      </td>
                      <td data-label="价格变化">
                        <strong>
                          {holding.changePercent === null
                            ? "数据不足"
                            : showSensitiveInfo
                              ? signedPercent(holding.changePercent)
                              : "••••••"}
                        </strong>
                        <span>来源可用价格变化</span>
                      </td>
                      <td data-label="平台盈亏">
                        <strong>{platformProfit}</strong>
                        <span>
                          {holding.platformProfit === null
                            ? "平台未提供"
                            : "平台原生口径"}
                        </span>
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
          来源总额与持仓明细的时间、汇率、产品覆盖和接口能力可不同。只有来源明确提供的平台盈亏才显示为平台盈亏；组合收益请前往收益分析。
        </VibeNotice>
      </section>
    </section>
  );
}
