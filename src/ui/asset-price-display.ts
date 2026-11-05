import type { AssetHolding } from "@/server/ports";

import { decimalCompare, decimalToFixed } from "@/domain/decimal";

function grouped(value: string): string {
  const [integer, fraction] = value.split(".");
  const formattedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${formattedInteger}.${fraction}` : formattedInteger;
}

/** 去掉小数部分尾随的无意义 0；整数部分的 0 属于有效数字，必须保留。 */
function trimTrailingZeros(value: string): string {
  const trimmed = value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return trimmed === "-0" || trimmed === "" ? "0" : trimmed;
}

/** 取到首个非零数字共 digits 位有效数字所需的小数位数。 */
function significantPlaces(value: string, digits: number): number {
  const [rawInteger, fraction = ""] = value.split(".");
  const integer = rawInteger.replace(/^0+/, "") || "0";
  if (integer !== "0") return Math.max(0, digits - integer.length);
  return fraction.length - fraction.replace(/^0+/, "").length + digits;
}

export function formatAssetUnitPrice(
  value: string,
  assetClass: AssetHolding["assetClass"],
): string {
  if (assetClass !== "crypto") return grouped(decimalToFixed(value, 2));
  // 价格以 USD 计价：达到 1 就按 2 位小数呈现；不足 1 时保留有效数字，
  // 否则 PEPE 一类的微小单价会被舍成 0.00。
  const absolute = value.startsWith("-") ? value.slice(1) : value;
  const places =
    decimalCompare(absolute, "1") >= 0 ? 2 : significantPlaces(absolute, 6);
  return grouped(trimTrailingZeros(decimalToFixed(value, places)));
}

/** 数量是来源直证值，按钱包/交易所精度习惯完整显示，只去尾随 0，不做任何舍入。 */
export function formatAssetQuantity(value: string): string {
  return grouped(trimTrailingZeros(value));
}

export function formatAssetAmount(value: string): string {
  const fixed = decimalToFixed(value, 2);
  if (decimalCompare(value, "0") !== 0 && decimalCompare(fixed, "0") === 0) {
    return value.startsWith("-") ? "-<0.01" : "<0.01";
  }
  return grouped(fixed);
}
