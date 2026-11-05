import type { CSSProperties } from "react";

const DOT_GLYPHS = {
  check: [
    ".........",
    ".......#.",
    "......#..",
    ".#...#...",
    "..#.#....",
    "...#.....",
    ".........",
    ".........",
    ".........",
  ],
  computer: [
    ".#######.",
    "#.......#",
    "#.......#",
    "#.......#",
    "#.......#",
    "#.......#",
    ".#######.",
    "....#....",
    "..#####..",
  ],
  error: [
    "#.......#",
    ".#.....#.",
    "..#...#..",
    "...#.#...",
    "....#....",
    "...#.#...",
    "..#...#..",
    ".#.....#.",
    "#.......#",
  ],
  gear: [
    "...###...",
    ".#.###.#.",
    ".#######.",
    "###...###",
    "###...###",
    "###...###",
    ".#######.",
    ".#.###.#.",
    "...###...",
  ],
  key: [
    ".####....",
    "#....#...",
    "#....#...",
    ".####....",
    "...#.....",
    "...#####.",
    "...#.#...",
    "...###...",
    ".........",
  ],
  lock: [
    "..#####..",
    ".#.....#.",
    ".#.....#.",
    "#########",
    "####.####",
    "###.#.###",
    "###.#.###",
    "####.####",
    "#########",
  ],
  moon: [
    "...###...",
    "..##.....",
    ".##......",
    ".#.......",
    ".#.......",
    ".#.......",
    ".##......",
    "..##.....",
    "...###...",
  ],
  sun: [
    "....#....",
    "#...#...#",
    "..#####..",
    ".#######.",
    "#######.#",
    ".#######.",
    "..#####..",
    "#...#...#",
    "....#....",
  ],
} as const;

export type VibeDotIconName = keyof typeof DOT_GLYPHS;

interface VibeDotIconProps {
  name: VibeDotIconName;
  size?: number;
}

type DotIconStyle = CSSProperties & { "--vibe-dot-icon-size": string };

export function VibeDotIcon({ name, size = 24 }: VibeDotIconProps) {
  const cells = DOT_GLYPHS[name].flatMap((row) => [...row]);

  return (
    <span
      aria-hidden="true"
      className="vibe-dot-icon"
      data-vibe-dot={name}
      style={{ "--vibe-dot-icon-size": `${size}px` } as DotIconStyle}
    >
      {cells.map((cell, index) => (
        <span
          className={cell === "#" ? "is-lit" : undefined}
          key={`${name}-${index}`}
        />
      ))}
    </span>
  );
}
