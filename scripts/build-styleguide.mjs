#!/usr/bin/env node
/**
 * Builds the design system deliverables from the repository's real runtime
 * sources. Nothing in the output is hand-authored:
 *
 *   docs/design-system/styleguide.html   self-contained, previewable styleguide
 *   docs/design-system/tokens.json       machine-readable token export
 *
 * Token values come from src/app/design-tokens.css, component recipes from
 * src/app/vibe-components.css, dot glyphs from src/ui/vibe/vibe-dot-icon.tsx
 * and line icons from src/ui/vibe/vibe-icon.tsx.
 *
 * Usage: pnpm design:styleguide [--relative-fonts]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  COLOR_GROUPS,
  BREAKPOINTS,
  ELEVATION_LAYERS,
  GAPS,
  MOTION_ITEMS,
  STATE_MACHINE,
  TYPE_ROLES,
  renderChromeCss,
  renderOverlays,
  renderScript,
  renderSections,
} from "./design-system/styleguide-sections.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT_DIR = join(ROOT, "docs/design-system");

const TOKENS_SOURCE = "src/app/design-tokens.css";
const RECIPE_SOURCE = "src/app/vibe-components.css";
const ICON_SOURCE = "src/ui/vibe/vibe-icon.tsx";
const GLYPH_SOURCE = "src/ui/vibe/vibe-dot-icon.tsx";
const FONT_DIR = "public/fonts/nothing-open";
const FONT_URL_PREFIX = "/fonts/nothing-open/";
const UPSTREAM =
  "wangbh030722/vibe-nothing-ui-design@46661e55ae04537215a229be49f2ac1bd37a4255";

const EMBED_FONTS = !process.argv.includes("--relative-fonts");

function read(relativePath) {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

/* ------------------------------------------------------------------ */
/* CSS parsing                                                         */
/* ------------------------------------------------------------------ */

function braceBlock(css, selector, from = 0) {
  const start = css.indexOf(selector, from);
  if (start === -1) throw new Error(`未找到选择器：${selector}`);
  const open = css.indexOf("{", start);
  if (open === -1) throw new Error(`选择器后缺少 {：${selector}`);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    const char = css[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return { raw: css.slice(start, index + 1), body: css.slice(open + 1, index), end: index + 1 };
      }
    }
  }
  throw new Error(`花括号未闭合：${selector}`);
}

function declarations(body) {
  const result = {};
  const pattern = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let match = pattern.exec(body);
  while (match) {
    result[match[1]] = match[2].trim().replace(/\s+/g, " ");
    match = pattern.exec(body);
  }
  return result;
}

function embedFontfaces(css) {
  return css.replace(/@font-face\s*\{[^}]*\}/g, (block) => {
    const urlMatch = /url\("([^"]+)"\)/.exec(block);
    if (!urlMatch) return block;
    const url = urlMatch[1];
    if (!url.startsWith(FONT_URL_PREFIX)) return block;
    const fileName = url.slice(FONT_URL_PREFIX.length);
    const absolute = join(ROOT, FONT_DIR, fileName);
    if (!existsSync(absolute)) {
      throw new Error(`字体文件缺失：${FONT_DIR}/${fileName}`);
    }
    const dataUri = `data:font/ttf;base64,${readFileSync(absolute).toString("base64")}`;
    const value = EMBED_FONTS
      ? `url("${dataUri}") format("truetype")`
      : `url("../../${FONT_DIR}/${fileName}") format("truetype")`;
    return block.replace(/url\("[^"]+"\)\s*format\("truetype"\)/, value);
  });
}

/* ------------------------------------------------------------------ */
/* TypeScript source parsing                                           */
/* ------------------------------------------------------------------ */

function parseLineIcons(source) {
  const start = source.indexOf("const paths = {");
  const end = source.indexOf("} satisfies", start);
  if (start === -1 || end === -1) throw new Error("vibe-icon.tsx 结构已变化，无法解析图标集。");
  const icons = [];
  for (const line of source.slice(start, end).split("\n")) {
    const match = /^\s*"?([A-Za-z][\w-]*)"?\s*:\s*(<[^]*>)\s*,\s*$/.exec(line);
    if (!match) continue;
    let inner = match[2].trim();
    if (inner.startsWith("<>") && inner.endsWith("</>")) {
      inner = inner.slice(2, -3);
    }
    if (!inner.includes("<")) continue;
    icons.push([match[1], inner]);
  }
  if (icons.length < 8) throw new Error(`解析到的线形图标过少：${icons.length}`);
  return icons;
}

function parseDotGlyphs(source) {
  const start = source.indexOf("const DOT_GLYPHS = {");
  const end = source.indexOf("} as const", start);
  if (start === -1 || end === -1) throw new Error("vibe-dot-icon.tsx 结构已变化，无法解析字形集。");
  const glyphs = [];
  let current = null;
  for (const line of source.slice(start, end).split("\n")) {
    const open = /^\s*"?([A-Za-z][\w-]*)"?\s*:\s*\[\s*$/.exec(line);
    if (open) {
      current = { name: open[1], rows: [] };
      continue;
    }
    if (current) {
      const row = /^\s*"([.#]+)"\s*,?\s*$/.exec(line);
      if (row) {
        current.rows.push(row[1]);
        continue;
      }
      if (/^\s*\]\s*,?\s*$/.test(line)) {
        if (current.rows.length !== 9 || current.rows.some((item) => item.length !== 9)) {
          throw new Error(`字形 ${current.name} 不是 9×9：${current.rows.length} 行`);
        }
        glyphs.push([current.name, current.rows]);
        current = null;
      }
    }
  }
  if (glyphs.length < 4) throw new Error(`解析到的点阵字形过少：${glyphs.length}`);
  return glyphs;
}

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

function main() {
  const tokensCss = read(TOKENS_SOURCE);
  const recipesCss = read(RECIPE_SOURCE);
  const iconSource = read(ICON_SOURCE);
  const glyphSource = read(GLYPH_SOURCE);

  const darkBlock = braceBlock(tokensCss, ':root,\n[data-theme="dark"]');
  const lightBlock = braceBlock(tokensCss, '[data-theme="light"]');
  const sharedBlock = braceBlock(tokensCss, ":root {", lightBlock.end);
  const darkPinned = `[data-sg-pin="dark"] {${darkBlock.body}}`;

  const dark = declarations(darkBlock.body);
  const light = declarations(lightBlock.body);
  const shared = declarations(sharedBlock.body);

  const lineIcons = parseLineIcons(iconSource);
  const dotGlyphs = parseDotGlyphs(glyphSource);

  const generatedAt = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";

  const context = {
    tokens: { dark, light, shared },
    lineIcons,
    dotGlyphs,
    meta: {
      upstream: UPSTREAM,
      generatedAt,
      tokensSource: TOKENS_SOURCE,
      recipeSource: RECIPE_SOURCE,
      iconSource: ICON_SOURCE,
      glyphSource: GLYPH_SOURCE,
    },
  };

  const html = `<!doctype html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark light" />
<title>Personal Asset Dashboard · 设计规范样式指南</title>
<style>
/* ==================================================================
 * 本文件是生成物，请勿手工编辑。
 * 重新生成：pnpm design:styleguide
 *
 * 1 · 字体与运行时 token ── 派生自 ${TOKENS_SOURCE}
 * ================================================================== */
${embedFontfaces(tokensCss)}

/* 控制台钉住的暗色 token 集，用于演示「工作台永远暗色」 */
${darkPinned}

/* ==================================================================
 * 2 · 组件配方 ── 派生自 ${RECIPE_SOURCE}
 * ================================================================== */
${recipesCss}

/* ==================================================================
 * 3 · 样式指南外壳（承载示例用，不属于设计系统）
 * ================================================================== */
${renderChromeCss()}
</style>
</head>
<body>
<header class="sg-header">
  <div>
    <p class="sg-header-mark">ASSET DASHBOARD</p>
    <p class="sg-header-meta">Design system styleguide · Upstream 46661e5 · ${generatedAt}</p>
  </div>
  <div aria-label="主题" class="sg-theme-toggle" role="group">
    <button aria-pressed="true" data-sg-theme="dark" type="button">DARK</button>
    <button aria-pressed="false" data-sg-theme="light" type="button">LIGHT</button>
  </div>
</header>
<main class="sg-page">
${renderSections(context)}
<footer class="sg-footer">
  本页面由 <code>pnpm design:styleguide</code> 从仓库真实运行时源文件生成，请勿手工编辑。<br />
  上游视觉契约：${UPSTREAM}（<a href="https://github.com/wangbh030722/vibe-nothing-ui-design/commit/46661e55ae04537215a229be49f2ac1bd37a4255">commit</a>）<br />
  token ${TOKENS_SOURCE} · 组件配方 ${RECIPE_SOURCE} · 字形 ${ICON_SOURCE} / ${GLYPH_SOURCE} · 生成于 ${generatedAt}
</footer>
</main>
${renderOverlays()}
<script>
${renderScript()}
</script>
</body>
</html>
`;

  const colorExport = {};
  for (const [name, value] of Object.entries(dark)) {
    const role =
      COLOR_GROUPS.flatMap((group) => group.tokens).find((token) => token.name === name)?.role ?? "";
    colorExport[name] = { dark: value, light: light[name] ?? null, role };
  }

  const tokensExport = {
    $generatedBy: "scripts/build-styleguide.mjs",
    generatedAt,
    upstream: UPSTREAM,
    sources: {
      tokens: TOKENS_SOURCE,
      recipes: RECIPE_SOURCE,
      lineIcons: ICON_SOURCE,
      dotGlyphs: GLYPH_SOURCE,
    },
    themes: ["dark", "light"],
    colorGroups: COLOR_GROUPS.map((group) => ({
      id: group.id,
      label: group.label,
      note: group.note,
      tokens: group.tokens.map((token) => token.name),
    })),
    color: colorExport,
    typography: {
      roles: TYPE_ROLES.map((role) => ({
        token: role.token,
        family: role.family,
        label: role.label,
        usage: role.usage,
        rule: role.rule,
        pageLevelOnly: role.pageLevelOnly === true,
        resolvedStack: shared[role.token] ?? null,
      })),
      scale: Object.fromEntries(
        Object.entries(shared).filter(([name]) => name.startsWith("--vibe-type-")),
      ),
    },
    geometry: {
      spacing: Object.fromEntries(
        Object.entries(shared).filter(([name]) => name.startsWith("--vibe-space-")),
      ),
      radius: Object.fromEntries(
        Object.entries(shared).filter(([name]) => name.startsWith("--r-")),
      ),
      easing: shared["--ease"] ?? null,
      motion: {
        fast: shared["--vibe-duration-fast"] ?? null,
        theme: shared["--vibe-duration-theme"] ?? null,
        rules: MOTION_ITEMS,
      },
      elevation: ELEVATION_LAYERS,
      controls: Object.fromEntries(
        Object.entries(shared).filter(([name]) => name.startsWith("--vibe-control-")),
      ),
    },
    stateMachine: STATE_MACHINE,
    breakpoints: BREAKPOINTS,
    componentGaps: GAPS,
    dotGlyphs: dotGlyphs.map(([name, rows]) => ({ name, rows })),
    lineIcons: lineIcons.map(([name]) => name),
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "styleguide.html"), html, "utf8");
  writeFileSync(join(OUT_DIR, "tokens.json"), `${JSON.stringify(tokensExport, null, 2)}\n`, "utf8");

  const sizeKb = (html.length / 1024).toFixed(0);
  process.stdout.write(
    [
      "已生成设计规范产物：",
      `  docs/design-system/styleguide.html  ${sizeKb} KB${EMBED_FONTS ? "（字体已内嵌）" : "（字体走相对路径）"}`,
      "  docs/design-system/tokens.json",
      "",
      `  色彩 token ${Object.keys(colorExport).length} 个 · 线形图标 ${lineIcons.length} 枚 · 点阵字形 ${dotGlyphs.length} 枚`,
      "",
    ].join("\n"),
  );
}

main();
