export function TrendDotPattern({
  height,
  id,
  top = 0,
}: {
  height: number;
  id: string;
  top?: number;
}) {
  const spacing = 8;
  const rows = Math.ceil(height / spacing);
  if (rows <= 0) return null;

  return (
    <pattern height={top + height} id={id} patternUnits="userSpaceOnUse" width={spacing}>
      {/* Fade each row so the dots stay discrete without a solid area fill. */}
      {Array.from({ length: rows }, (_, row) => (
        <circle
          key={row}
          cx={spacing / 2}
          cy={top + row * spacing + spacing / 2}
          r={1}
          style={{
            fill: "var(--display)",
            opacity: 0.72 * (1 - row / rows),
          }}
        />
      ))}
    </pattern>
  );
}
