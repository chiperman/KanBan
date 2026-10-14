type Rgb = [number, number, number];
type Rgba = [number, number, number, number];

export function parseColor(color: string): Rgba {
  if (color === "transparent") return [0, 0, 0, 0];
  const rgb = color.match(/^rgba?\(([^)]+)\)$/);
  const srgb = color.match(/^color\(srgb\s+([^)]+)\)$/);
  const values = (rgb?.[1] ?? srgb?.[1])?.trim().split(/[,\s/]+/);
  if (!values || (values.length !== 3 && values.length !== 4)) {
    throw new Error(`Unsupported computed color: ${color}`);
  }
  const channels = values.slice(0, 3).map((value) => {
    if (value.endsWith("%")) return Number(value.slice(0, -1)) / 100 * 255;
    return Number(value) * (srgb ? 255 : 1);
  });
  const alpha = values[3] === undefined
    ? 1
    : values[3].endsWith("%")
      ? Number(values[3].slice(0, -1)) / 100
      : Number(values[3]);
  if (![...channels, alpha].every(Number.isFinite)) {
    throw new Error(`Invalid computed color: ${color}`);
  }
  return [channels[0], channels[1], channels[2], alpha];
}

function composite(foreground: Rgba, background: Rgb): Rgb {
  const alpha = foreground[3];
  return background.map((channel, index) =>
    foreground[index] * alpha + channel * (1 - alpha),
  ) as Rgb;
}

function luminance(rgb: Rgb): number {
  const [red, green, blue] = rgb.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(
  foreground: string,
  backgrounds: readonly string[],
): number {
  // Computed backgrounds arrive from the element outward; paint ancestors first.
  const background = [...backgrounds].reverse().reduce<Rgb>(
    (result, color) => composite(parseColor(color), result),
    [255, 255, 255],
  );
  const text = composite(parseColor(foreground), background);
  const lighter = Math.max(luminance(text), luminance(background));
  const darker = Math.min(luminance(text), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}
