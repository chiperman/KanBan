import type { AssetHolding } from "@/server/ports";
import { assetHoldingKey, assetHoldingDisplayName, AssetHoldingPositionStatus } from "@/ui/asset-product-coverage";
import { profitDirection, type ProfitColorScheme } from "@/ui/profit-color-scheme";
import { AssetFinancialValue } from "@/ui/asset-financial-value";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeStatusTag } from "@/ui/vibe/vibe-data-instrument";
import { signedAmount, signedDisplayAmount } from "@/ui/signed-amount";
import { amount, holdingProfit, holdingTodayProfit, holdingQuoteSessionText, holdingValuationDetail } from "./holding-detail-model";

function HoldingSensitiveValue({
  value,
  showSensitiveInfo,
  financial = true,
}: {
  value: string;
  showSensitiveInfo: boolean;
  financial?: boolean;
}) {
  // 只预留字符宽度，隐藏状态不把真实读数留在 DOM 中。
  const style = { minInlineSize: `${Math.max(6, value.length)}ch` };
  const text = showSensitiveInfo ? value : "••••••";
  return financial ? (
    <AssetFinancialValue className="holding-sensitive-value" style={style}>
      {text}
    </AssetFinancialValue>
  ) : (
    <span className="holding-sensitive-value" style={style}>{text}</span>
  );
}

function displayDirection(
  value: string,
  showSensitiveInfo: boolean,
): "positive" | "negative" | "neutral" {
  if (!showSensitiveInfo) return "neutral";
  return profitDirection(value);
}

function HoldingProfitSummaryCell({
  currency,
  profit,
  kind,
  profitColorScheme,
  showSensitiveInfo,
  formatDisplayMoney,
}: {
  currency: string;
  profit: { amount: string; percent: string } | null;
  kind: "today" | "position";
  profitColorScheme: ProfitColorScheme;
  showSensitiveInfo: boolean;
  formatDisplayMoney: (value: string, currency: string) => string | null;
}) {
  const displayedAmount = profit === null
    ? null
    : formatDisplayMoney(profit.amount, currency);
  return (
    <td
      className={`holding-profit-summary holding-profit-summary--${kind} profit-color-value`}
      data-profit-color-scheme={profitColorScheme}
      data-profit-direction={
        profit === null
          ? "neutral"
          : displayDirection(profit.amount, showSensitiveInfo)
      }
    >
      <div className="holding-value-pair">
        <strong>
          {profit === null
            ? "—"
            : displayedAmount === null
              ? "无法折算"
              : <HoldingSensitiveValue
                  showSensitiveInfo={showSensitiveInfo}
                  value={signedDisplayAmount(profit.amount, displayedAmount)}
                />}
        </strong>
        <span>
          {profit === null
            ? "—"
            : <HoldingSensitiveValue
                showSensitiveInfo={showSensitiveInfo}
                value={`${signedAmount(profit.percent, amount)}%`}
              />}
        </span>
      </div>
    </td>
  );
}

function HoldingMarketValueQuantityCell({
  holding,
  quoteUnavailable,
  showSensitiveInfo,
  formatDisplayMoney,
}: {
  holding: AssetHolding;
  quoteUnavailable: boolean;
  showSensitiveInfo: boolean;
  formatDisplayMoney: (value: string, currency: string) => string | null;
}) {
  const displayedMarketValue = holding.marketValue === null
    ? null
    : formatDisplayMoney(holding.marketValue, holding.currency);
  return (
    <td className="holding-market-value-summary">
      <div className="holding-value-pair">
        <strong className={holding.marketValue === null ? "holding-value-unavailable" : undefined}>
          {holding.marketValue === null
            ? quoteUnavailable
              ? "期权行情未接入"
              : "未估值"
            : displayedMarketValue === null
              ? "无法折算"
              : <HoldingSensitiveValue showSensitiveInfo={showSensitiveInfo} value={displayedMarketValue} />}
        </strong>
        <span>
          <HoldingSensitiveValue financial={false} showSensitiveInfo={showSensitiveInfo} value={amount(holding.quantity)} />
        </span>
      </div>
    </td>
  );
}

function HoldingCostPrice({
  holding,
  showSensitiveInfo,
  formatDisplayPrice,
}: {
  holding: AssetHolding;
  showSensitiveInfo: boolean;
  formatDisplayPrice: (
    value: string,
    currency: string,
    assetClass: AssetHolding["assetClass"],
  ) => string | null;
}) {
  if (holding.costPrice === null) return "—";
  const price = formatDisplayPrice(
    holding.costPrice,
    holding.currency,
    holding.assetClass,
  );
  if (price === null) return "无法折算";
  return (
    <>
      <HoldingSensitiveValue showSensitiveInfo={showSensitiveInfo} value={price} />
      {holding.costPriceSource ? (
        <span className="holding-price-source">，{holding.costPriceSource}</span>
      ) : null}
    </>
  );
}

function HoldingCurrentPrice({
  holding,
  quoteUnavailable,
  showSensitiveInfo,
  formatDisplayPrice,
}: {
  holding: AssetHolding;
  quoteUnavailable: boolean;
  showSensitiveInfo: boolean;
  formatDisplayPrice: (
    value: string,
    currency: string,
    assetClass: AssetHolding["assetClass"],
  ) => string | null;
}) {
  const formattedCurrentPrice = holding.currentPrice
    ? formatDisplayPrice(
      holding.currentPrice.amount,
      holding.currentPrice.currency,
      holding.assetClass,
    )
    : null;
  const currentPrice = holding.currentPrice
    ? "无法折算"
    : quoteUnavailable
      ? "现价不可用"
      : holding.valuation.status === "unvalued"
        ? "未估值"
        : "—";
  const session = holdingQuoteSessionText(holding, false);
  return (
    <div className="holding-current-quote">
      {session ? (
        <VibeStatusTag title={holdingQuoteSessionText(holding) ?? undefined}>
          {session}
        </VibeStatusTag>
      ) : null}
      <strong className={`holding-current-price${holding.currentPrice === null ? " holding-value-unavailable" : ""}`}>
        {formattedCurrentPrice !== null
          ? <HoldingSensitiveValue showSensitiveInfo={showSensitiveInfo} value={formattedCurrentPrice} />
          : currentPrice}
      </strong>
    </div>
  );
}

function HoldingCurrentCostPriceCell({
  holding,
  quoteUnavailable,
  showSensitiveInfo,
  formatDisplayPrice,
}: {
  holding: AssetHolding;
  quoteUnavailable: boolean;
  showSensitiveInfo: boolean;
  formatDisplayPrice: (
    value: string,
    currency: string,
    assetClass: AssetHolding["assetClass"],
  ) => string | null;
}) {
  return (
    <td className="holding-current-cost-price">
      <div className="holding-value-pair holding-price-pair">
        <HoldingCurrentPrice
          formatDisplayPrice={formatDisplayPrice}
          holding={holding}
          quoteUnavailable={quoteUnavailable}
          showSensitiveInfo={showSensitiveInfo}
        />
        <span className="holding-cost-price">
          <HoldingCostPrice
            formatDisplayPrice={formatDisplayPrice}
            holding={holding}
            showSensitiveInfo={showSensitiveInfo}
          />
        </span>
      </div>
    </td>
  );
}

export function HoldingDetailRow({
  holding,
  onShowCandlesticks,
  profitColorScheme,
  showPlatformProfit,
  compactProfitColumns,
  showSensitiveInfo,
  formatDisplayMoney,
  formatDisplayPrice,
}: {
  holding: AssetHolding;
  onShowCandlesticks?: (holding: AssetHolding) => void;
  profitColorScheme: ProfitColorScheme;
  showPlatformProfit: boolean;
  compactProfitColumns: boolean;
  showSensitiveInfo: boolean;
  formatDisplayMoney: (value: string, currency: string) => string | null;
  formatDisplayPrice: (
    value: string,
    currency: string,
    assetClass: AssetHolding["assetClass"],
  ) => string | null;
}) {
  const quoteUnavailable = holding.valuation.status === "quote-unavailable";
  const valuationDetail = holdingValuationDetail(holding);
  const profit = holdingProfit(holding);
  const todayProfit = holdingTodayProfit(holding);
  return (
    <tr
      className={holding.valuation.status === "unvalued" ? "is-unvalued" : undefined}
      data-holding-key={assetHoldingKey(holding)}
    >
      <td>
        <strong className="holding-name">
          {assetHoldingDisplayName(holding)}
          {onShowCandlesticks ? (
            <VibeButton
              className="holding-candlestick-trigger"
              disabled={!showSensitiveInfo}
              onClick={() => onShowCandlesticks(holding)}
              type="button"
              variant="text"
            >
              K线
            </VibeButton>
          ) : null}
        </strong>
        <AssetHoldingPositionStatus holding={holding} />
        <span className="holding-symbol">{holding.symbol}</span>
        <span className="holding-price-source">{valuationDetail}</span>
      </td>
      {compactProfitColumns ? (
        <>
          <HoldingMarketValueQuantityCell
            formatDisplayMoney={formatDisplayMoney}
            holding={holding}
            quoteUnavailable={quoteUnavailable}
            showSensitiveInfo={showSensitiveInfo}
          />
          <HoldingCurrentCostPriceCell
            formatDisplayPrice={formatDisplayPrice}
            holding={holding}
            quoteUnavailable={quoteUnavailable}
            showSensitiveInfo={showSensitiveInfo}
          />
          <HoldingProfitSummaryCell
            currency={holding.currency}
            formatDisplayMoney={formatDisplayMoney}
            kind="today"
            profit={todayProfit}
            profitColorScheme={profitColorScheme}
            showSensitiveInfo={showSensitiveInfo}
          />
          <HoldingProfitSummaryCell
            currency={holding.currency}
            formatDisplayMoney={formatDisplayMoney}
            kind="position"
            profit={profit}
            profitColorScheme={profitColorScheme}
            showSensitiveInfo={showSensitiveInfo}
          />
        </>
      ) : (
        <>
          <td>
            <HoldingSensitiveValue financial={false} showSensitiveInfo={showSensitiveInfo} value={amount(holding.quantity)} />
          </td>
          <td className="holding-current-price-cell">
            <HoldingCurrentPrice
              formatDisplayPrice={formatDisplayPrice}
              holding={holding}
              quoteUnavailable={quoteUnavailable}
              showSensitiveInfo={showSensitiveInfo}
            />
          </td>
          <td>
            {holding.marketValue === null
              ? quoteUnavailable
                ? "期权行情未接入"
                : "未估值"
              : (() => {
                  const value = formatDisplayMoney(holding.marketValue, holding.currency);
                  return value === null
                    ? "无法折算"
                    : <HoldingSensitiveValue showSensitiveInfo={showSensitiveInfo} value={value} />;
                })()}
          </td>
          <td>
            <HoldingCostPrice
              formatDisplayPrice={formatDisplayPrice}
              holding={holding}
              showSensitiveInfo={showSensitiveInfo}
            />
          </td>
          {showPlatformProfit ? (
            <td>
              {holding.platformProfit === null
                ? "—"
                : (() => {
                    const value = formatDisplayMoney(holding.platformProfit, holding.currency);
                    return value === null
                      ? "无法折算"
                      : <HoldingSensitiveValue showSensitiveInfo={showSensitiveInfo} value={value} />;
                  })()}
            </td>
          ) : null}
          <td
            className="holding-profit profit-color-value"
            data-profit-color-scheme={profitColorScheme}
            data-profit-direction={
              profit === null
                ? "neutral"
                : displayDirection(profit.amount, showSensitiveInfo)
            }
          >
            {profit === null
              ? "—"
              : (() => {
                  const displayed = formatDisplayMoney(profit.amount, holding.currency);
                  return displayed === null
                    ? "无法折算"
                    : <HoldingSensitiveValue
                        showSensitiveInfo={showSensitiveInfo}
                        value={signedDisplayAmount(profit.amount, displayed)}
                      />;
                })()}
          </td>
          <td
            className="holding-profit profit-color-value"
            data-profit-color-scheme={profitColorScheme}
            data-profit-direction={
              profit === null
                ? "neutral"
                : displayDirection(profit.percent, showSensitiveInfo)
            }
          >
            {profit === null
              ? "—"
              : <HoldingSensitiveValue
                  showSensitiveInfo={showSensitiveInfo}
                  value={`${signedAmount(profit.percent, amount)}%`}
                />}
          </td>
        </>
      )}
    </tr>
  );
}
