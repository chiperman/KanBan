import type { AssetHolding } from "@/server/ports";
import { assetHoldingKey, assetHoldingDisplayName, AssetHoldingPositionStatus } from "@/ui/asset-product-coverage";
import { profitDirection, type ProfitColorScheme } from "@/ui/profit-color-scheme";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { signedAmount, signedDisplayAmount } from "@/ui/signed-amount";
import { amount, holdingProfit, holdingTodayProfit, holdingQuoteSessionText, holdingValuationDetail } from "./holding-detail-model";

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
  const masked = "••••••";
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
      <strong>
        {profit === null
          ? "—"
          : !showSensitiveInfo
            ? masked
            : displayedAmount === null
              ? "无法折算"
              : signedDisplayAmount(profit.amount, displayedAmount)}
      </strong>
      <span>
        {profit === null
          ? "—"
          : showSensitiveInfo
            ? `${signedAmount(profit.percent, amount)}%`
            : masked}
      </span>
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
  const masked = "••••••";
  const displayedMarketValue = holding.marketValue === null
    ? null
    : formatDisplayMoney(holding.marketValue, holding.currency);
  return (
    <td className="holding-market-value-summary">
      <strong>
        {holding.marketValue === null
          ? quoteUnavailable
            ? "期权行情未接入"
            : "未估值"
          : !showSensitiveInfo
            ? masked
            : displayedMarketValue ?? "无法折算"}
      </strong>
      <span>{showSensitiveInfo ? amount(holding.quantity) : masked}</span>
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
  if (!showSensitiveInfo) return "••••••";
  const price = formatDisplayPrice(
    holding.costPrice,
    holding.currency,
    holding.assetClass,
  );
  if (price === null) return "无法折算";
  return (
    <>
      {price}
      {holding.costPriceSource ? (
        <span className="holding-price-source"> · {holding.costPriceSource}</span>
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
  const masked = "••••••";
  const currentPrice = holding.currentPrice
    ? !showSensitiveInfo
      ? masked
      : formatDisplayPrice(
        holding.currentPrice.amount,
        holding.currentPrice.currency,
        holding.assetClass,
      ) ?? "无法折算"
    : quoteUnavailable
      ? "现价不可用"
      : holding.valuation.status === "unvalued"
        ? "未估值"
        : "—";
  const session = holdingQuoteSessionText(holding, showSensitiveInfo);
  return (
    <>
      <strong className="holding-current-price">{currentPrice}</strong>
      {session ? <span className="holding-quote-session">{session}</span> : null}
    </>
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
      <HoldingCurrentPrice
        formatDisplayPrice={formatDisplayPrice}
        holding={holding}
        quoteUnavailable={quoteUnavailable}
        showSensitiveInfo={showSensitiveInfo}
      />
      <span>
        <HoldingCostPrice
          formatDisplayPrice={formatDisplayPrice}
          holding={holding}
          showSensitiveInfo={showSensitiveInfo}
        />
      </span>
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
  const masked = "••••••";
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
          <td>{showSensitiveInfo ? amount(holding.quantity) : masked}</td>
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
              : !showSensitiveInfo
                ? masked
                : formatDisplayMoney(holding.marketValue, holding.currency) ?? "无法折算"}
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
                : !showSensitiveInfo
                  ? masked
                  : formatDisplayMoney(holding.platformProfit, holding.currency) ?? "无法折算"}
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
              : !showSensitiveInfo
                ? masked
                : (() => {
                  const displayed = formatDisplayMoney(profit.amount, holding.currency);
                  return displayed === null
                    ? "无法折算"
                    : signedDisplayAmount(profit.amount, displayed);
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
              : showSensitiveInfo
                ? `${signedAmount(profit.percent, amount)}%`
                : masked}
          </td>
        </>
      )}
    </tr>
  );
}
