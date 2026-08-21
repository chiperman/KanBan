export type JsonRecord = Record<string, unknown>;

export interface JsonDecoder {
  record(value: unknown, context?: string): JsonRecord;
  list(value: unknown, context: string): JsonRecord[];
  text(value: unknown, field: string): string;
  nonNegativeDecimal(value: unknown, field: string): string;
  identifier(value: unknown, field: string): string;
}

export function createJsonDecoder(provider: string): JsonDecoder {
  const response = `${provider} 响应`;

  function record(value: unknown, context = response): JsonRecord {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`${context}格式无效`);
    }
    return value as JsonRecord;
  }

  function list(value: unknown, context: string): JsonRecord[] {
    if (!Array.isArray(value)) throw new Error(`${context}格式无效`);
    return value.map((item) => record(item, context));
  }

  function text(value: unknown, field: string): string {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`${response}缺少 ${field}`);
    }
    return value;
  }

  function nonNegativeDecimal(value: unknown, field: string): string {
    if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) {
      throw new Error(`${provider} 响应中的 ${field} 不是有效非负十进制数`);
    }
    return value;
  }

  function identifier(value: unknown, field: string): string {
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
      return String(value);
    }
    throw new Error(`${response}缺少 ${field}`);
  }

  return { record, list, text, nonNegativeDecimal, identifier };
}
