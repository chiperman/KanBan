import type { AssetHolding } from "@/server/ports";

import { decimalToFixed } from "@/domain/decimal";

function grouped(value: string): string {
  const [integer, fraction] = value.split(".");
  const formattedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${formattedInteger}.${fraction}` : formattedInteger;
}

export function formatAssetUnitPrice(
  value: string,
  assetClass: AssetHolding["assetClass"],
): string {
  return grouped(
    assetClass === "crypto" ? value : decimalToFixed(value, 2),
  );
}
