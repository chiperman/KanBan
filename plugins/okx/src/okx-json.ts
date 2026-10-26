import { decimalCompare } from "@/domain/decimal";
import { createJsonDecoder } from "../../sdk/json";
import type { JsonRecord } from "../../sdk/json";

export type { JsonRecord };

const { list, nonNegativeDecimal: decimal } = createJsonDecoder("OKX");

export const OKX_EQUITY_ROUNDING_TOLERANCE = "0.000000000001";

export function zeroOrEmpty(value: unknown, field: string): boolean {
  if (value === "") return true;
  return decimalCompare(decimal(value, field), "0") === 0;
}

export function first(value: unknown, context: string): JsonRecord {
  const values = list(value, context);
  if (values.length !== 1) throw new Error(`${context}必须仅包含一项`);
  return values[0];
}
