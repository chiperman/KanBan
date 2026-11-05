interface DecimalParts {
  digits: bigint;
  scale: number;
}

function parse(value: string): DecimalParts {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new Error(`无效十进制数：${value}`);
  const fraction = match[3] ?? "";
  const digits = BigInt(`${match[2]}${fraction}`);
  return {
    digits: match[1] === "-" ? -digits : digits,
    scale: fraction.length,
  };
}

function power(value: number): bigint {
  return 10n ** BigInt(value);
}

function stringify(value: DecimalParts, keepScale = false): string {
  const negative = value.digits < 0n;
  const absolute = negative ? -value.digits : value.digits;
  if (value.scale === 0) return `${negative ? "-" : ""}${absolute}`;
  const digits = absolute.toString().padStart(value.scale + 1, "0");
  const integer = digits.slice(0, -value.scale);
  const rawFraction = digits.slice(-value.scale);
  const fraction = keepScale ? rawFraction : rawFraction.replace(/0+$/, "");
  return `${negative ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
}

function align(left: DecimalParts, right: DecimalParts) {
  const scale = Math.max(left.scale, right.scale);
  return {
    left: left.digits * power(scale - left.scale),
    right: right.digits * power(scale - right.scale),
    scale,
  };
}

export function decimalAdd(...values: string[]): string {
  let result: DecimalParts = { digits: 0n, scale: 0 };
  for (const value of values) {
    const next = parse(value);
    const aligned = align(result, next);
    result = { digits: aligned.left + aligned.right, scale: aligned.scale };
  }
  return stringify(result);
}

export function decimalSubtract(left: string, right: string): string {
  const value = parse(right);
  return decimalAdd(left, stringify({ ...value, digits: -value.digits }));
}

export function decimalMultiply(left: string, right: string): string {
  const a = parse(left);
  const b = parse(right);
  return stringify({ digits: a.digits * b.digits, scale: a.scale + b.scale });
}

export function decimalDivide(
  left: string,
  right: string,
  precision = 18,
): string {
  const a = parse(left);
  const b = parse(right);
  if (b.digits === 0n) throw new Error("不能除以零");
  return stringify({
    digits:
      (a.digits * power(b.scale + precision)) /
      (b.digits * power(a.scale)),
    scale: precision,
  });
}

export function decimalCompare(left: string, right: string): number {
  const aligned = align(parse(left), parse(right));
  return aligned.left < aligned.right ? -1 : aligned.left > aligned.right ? 1 : 0;
}

export function decimalToFixed(value: string, places: number): string {
  const parsed = parse(value);
  if (parsed.scale <= places) {
    return stringify(
      {
        digits: parsed.digits * power(places - parsed.scale),
        scale: places,
      },
      true,
    );
  }
  const divisor = power(parsed.scale - places);
  const negative = parsed.digits < 0n;
  const absolute = negative ? -parsed.digits : parsed.digits;
  let rounded = absolute / divisor;
  if ((absolute % divisor) * 2n >= divisor) rounded += 1n;
  return stringify(
    { digits: negative ? -rounded : rounded, scale: places },
    true,
  );
}

export function decimalTruncateToFixed(value: string, places: number): string {
  const parsed = parse(value);
  if (parsed.scale <= places) {
    return stringify(
      {
        digits: parsed.digits * power(places - parsed.scale),
        scale: places,
      },
      true,
    );
  }
  return stringify(
    {
      digits: parsed.digits / power(parsed.scale - places),
      scale: places,
    },
    true,
  );
}
