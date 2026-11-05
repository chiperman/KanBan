#!/usr/bin/env node
/**
 * 设计 token 守门脚本。
 *
 * 规范文档（`docs/design-system/`）能说明规则，但拦不住新代码继续引入裸值。
 * 这个脚本把交付前检查清单里**可以机械判定**的那几条固化下来：新增违规即失败。
 *
 *   node scripts/lint-design-tokens.mjs            # 校验
 *   node scripts/lint-design-tokens.mjs --verbose  # 额外提示可收紧的基线条目
 *   node scripts/lint-design-tokens.mjs --update   # 用当前状态重写基线
 *
 * 用法：pnpm design:lint / pnpm design:lint -- --update
 *
 * 设计要点：
 *
 * 1. **判定的是声明本身，不是行号。** 基线里存的是
 *    `<规则>|<文件>|<规范化后的声明文本>` 这样的内容签名及其出现次数，
 *    所以挪动代码、重排文件都不会产生假的新增告警；只有真正多出来一处才算。
 * 2. **字号刻度从 `design-tokens.css` 现读。** 新增一档 `--vibe-type-*`
 *    会自动被放行，不需要回来改这个脚本。
 * 3. **存量走基线豁免，不靠白名单文件。** 基线记录每条的现有数量，
 *    修掉之后数量下降只会提示"可收紧"，不会让校验失败。
 * 4. **按设计豁免的写进规则，不写进基线。** SVG 用户坐标系里的字号（`SVG_TEXT_SELECTORS`）
 *    不是欠账，所以不占基线条目。基线只记录待偿还的存量。
 * 5. **未定义 token 是独立一条规则。** `var(--x)` 指向不存在的变量时浏览器不报错，
 *    只是静默丢弃声明或退回 fallback —— 这是靠读代码最难发现的一类问题，必须机器判。
 *
 * 现行设计规则从 `DESIGN.md` 阅读，待处理差异统一见 `docs/backlog.md`。
 * 本脚本只负责守门新增违反项，存量签名保存在基线中。
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const TOKENS_FILE = "src/app/design-tokens.css";
const CSS_DIR = "src/app";
const SOURCE_ROOTS = ["src/ui"];
const BASELINE_FILE = "scripts/design-system/token-lint-baseline.json";

/**
 * 规范承认四档断点（0 / 640 / 1024 / 1200）。0 是隐含基准，因此只需列出另外三档；
 * `max-width` 用各自减 1 的标准写法，"低于 640" 即 639。
 */
const BREAKPOINTS = {
  "min-width": new Set([640, 1024, 1200]),
  "max-width": new Set([639, 1023, 1199]),
};

/**
 * SVG 用户坐标系里的字号不是排版字号：那里的 `px` 是图纸单位，会随 viewBox 缩放，
 * 排版级差对它没有意义（见 docs/design-system/foundations.md 的排版级差）。这两条是**按设计豁免**，不是欠账，
 * 所以写进规则里，而不是塞进基线 —— 基线只应该记录待偿还的存量。
 */
const SVG_TEXT_SELECTORS = [".locked-flow-screen text", ".locked-flow-dashboard-label"];

/**
 * 全局减弱动效覆盖。该规则必须使用 !important 才能压过所有组件动效，
 * 是明确的无障碍例外，不占基线额度。
 */
const GLOBAL_REDUCED_MOTION_SELECTOR = "*, *::before, *::after";
const REDUCED_MOTION_IMPORTANT_DECLARATIONS = new Set([
  "animation-duration: 0.01ms !important",
  "animation-iteration-count: 1 !important",
  "transition-duration: 0.01ms !important",
]);

/**
 * 页面级样式不得覆盖共享按钮的视觉属性：统一规范后，颜色 / 背景 / 边框 /
 * 圆角 / 字体 / 高度 / 透明度 / 过渡 / 变换 / outline / box-shadow 只能来自
 * `src/app/vibe-components.css`。本规则递归扫描 `src/app/` 的 CSS，排除共享组件文件，
 * 命中标准按钮选择器时，只允许布局声明，其余一律报错且不可基线化。
 */
const BUTTON_OVERRIDE_SELECTORS = [
  /\.vibe-button\b/,
  /\[data-vibe-component="button"\]/,
  /\[data-vibe-component="link"\]/,
  /\bbutton\b/,
  /\.danger-button\b/,
  /\.header-action-button\b/,
  /\.command-menu-trigger\b/,
  /\.command-menu-close\b/,
  /\.command-menu-item\b/,
  /\.theme-toggle\b/,
  /\.workbench-navigation-link\b/,
  /\.secondary-button\b/,
];

/** 命中按钮选择器时允许出现的布局属性白名单；其余视觉属性应回到共享组件。 */
const BUTTON_LAYOUT_PROPERTIES = new Set([
  "display",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "inset",
  "z-index",
  "flex",
  "flex-direction",
  "flex-wrap",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "align-items",
  "align-self",
  "justify-content",
  "justify-self",
  "place-items",
  "gap",
  "row-gap",
  "column-gap",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "padding-inline",
  "padding-block",
  "min-width",
  "max-width",
  "width",
  "min-height",
  "max-height",
  "height",
  "aspect-ratio",
  "grid-template-columns",
  "grid-template-rows",
  "grid-column",
  "grid-row",
  "grid-area",
  "overflow",
  "overflow-x",
  "overflow-y",
  "overflow-wrap",
  "white-space",
  "box-sizing",
  "text-align",
  "text-transform",
  "visibility",
  "content",
]);

/** 命中按钮选择器且属于视觉覆盖的属性名。 */
const BUTTON_VISUAL_PROPERTIES = [
  "color",
  "background",
  "background-color",
  "border",
  "border-color",
  "border-top",
  "border-top-width",
  "border-top-style",
  "border-top-color",
  "border-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "font",
  "font-family",
  "font-size",
  "font-weight",
  "letter-spacing",
  "line-height",
  "opacity",
  "transition",
  "transition-property",
  "transition-duration",
  "transform",
  "outline",
  "outline-offset",
  "box-shadow",
  "appearance",
  "cursor",
];


const RULE_LABEL = {
  "raw-hex": "硬编码色值",
  "raw-color-fn": "硬编码颜色函数",
  "px-radius": "px 圆角",
  "offscale-font-size": "表外字号",
  "offscale-breakpoint": "表外断点",
  "raw-font-stack": "硬编码字体栈",
  "box-shadow": "box-shadow",
  important: "!important",
  "undefined-design-token": "引用了不存在的 token",
  "page-button-override": "页面样式覆盖共享按钮视觉属性",
};

// ---------------------------------------------------------------------------
// 读取真实刻度
// ---------------------------------------------------------------------------

const tokensSource = readFileSync(TOKENS_FILE, "utf8");

/** 从 design-tokens.css 读出 `--vibe-type-*` 的 px 取值，作为字号级差。 */
function readTypeScale(source) {
  const scale = new Set();
  for (const match of source.matchAll(/--vibe-type-[a-z-]+:\s*([\d.]+)px/g)) {
    scale.add(Number.parseFloat(match[1]));
  }
  if (scale.size < 3 || scale.size > 4 || Math.min(...scale) < 12) {
    throw new Error(`${TOKENS_FILE} 必须使用 3–4 档字号，且最小为 12px`);
  }
  return scale;
}

const TYPE_SCALE = readTypeScale(tokensSource);

// ---------------------------------------------------------------------------
// 扫描
// ---------------------------------------------------------------------------

const collapse = (text) => text.replace(/\s+/g, " ").trim();
const lineAt = (source, index) => source.slice(0, index).split("\n").length;

/**
 * 一条违规。`key` 会写进基线，故意不含行号。
 */
const violation = (rule, file, key, line, message) => ({ rule, file, key, line, message });

/** 遍历 CSS 里的每条声明；只取最内层块，因此 `@media` 包裹会自动被穿透。 */
function walkDeclarations(source, visit) {
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = collapse(match[1]);
    // 块起始行只用于回退；实际声明行按其在块内文本中的换行数推算，
    // 这样报错能精确定位到具体声明，而不是整条规则第一行。
    const blockStartLine = lineAt(source, match.index);
    const blockText = match[2];
    let cursor = 0;
    let line = blockStartLine;
    for (const declaration of match[2].split(";")) {
      const text = collapse(declaration);
      // 推进到本条声明之后的换行，得到下一条声明的起始行。
      const segment = blockText.slice(cursor, cursor + declaration.length);
      const newlines = (segment.match(/\n/g) ?? []).length;
      line = blockStartLine + newlines;
      cursor += declaration.length + 1;
      if (text) visit(selector, text, line);
    }
  }
}

/** `@media` 前奏里的断点值不在普通声明里，单独扫。 */
function walkMediaQueries(source, visit) {
  for (const match of source.matchAll(/@media[^{]*/g)) {
    const prelude = collapse(match[0]);
    const line = lineAt(source, match.index);
    for (const part of prelude.matchAll(/(min-width|max-width):\s*([\d.]+)px/g)) {
      visit(prelude, part[1], Number.parseFloat(part[2]), line);
    }
  }
}

function lintCss(file, source) {
  const found = [];
  // design-tokens.css 是 token 的定义处，裸色值在那里是合法的。
  const isTokenFile = file === TOKENS_FILE;
  // 共享组件文件是唯一允许定义按钮视觉属性的地方；其余页面 CSS 只许布局。
  const isSharedComponentFile = file === "src/app/vibe-components.css";

  if (!isTokenFile) {
    for (const match of source.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      found.push(
        violation("raw-hex", file, match[0].toLowerCase(), lineAt(source, match.index), `硬编码色值 ${match[0]}，请改用语义 token`),
      );
    }
    for (const match of source.matchAll(/\b(?:rgba?|hsla?|oklch)\(/g)) {
      found.push(
        violation("raw-color-fn", file, match[0], lineAt(source, match.index), `硬编码颜色函数 ${match[0]}，请改用语义 token`),
      );
    }
  }

  walkDeclarations(source, (selector, declaration, line) => {
    // 页面级规则不得覆盖共享按钮视觉属性；共享组件文件与全局焦点规则放行。
    if (!isSharedComponentFile && !selector.includes(":focus-visible")) {
      const hitsButton = BUTTON_OVERRIDE_SELECTORS.some((pattern) => pattern.test(selector));
      if (hitsButton) {
        const propertyName = declaration.split(":")[0]?.trim();
        const visual = propertyName
          ? BUTTON_VISUAL_PROPERTIES.find((prop) =>
              propertyName === prop || propertyName.startsWith(`${prop}-`),
            )
          : null;
        if (visual && !BUTTON_LAYOUT_PROPERTIES.has(visual)) {
          found.push(
            violation(
              "page-button-override",
              file,
              `${selector} → ${declaration}`,
              line,
              `${selector} → 页面样式覆盖按钮视觉属性「${visual}」，应回到 src/app/vibe-components.css，见 docs/design-system/components.md#按钮与名称链接`,
            ),
          );
        }
      }
    }

    const radius = declaration.match(/^border-radius:\s*(.+)$/);
    if (radius && /[\d.]+px/.test(radius[1])) {
      found.push(violation("px-radius", file, declaration, line, `${selector} → ${declaration}；圆角请用 var(--r-sm-\\-md-\\-pill)`));
    }

    const fontSize = declaration.match(/^font-size:\s*([\d.]+)px(?:\s*!important)?$/);
    if (fontSize && !TYPE_SCALE.has(Number.parseFloat(fontSize[1]))) {
      const inSvgCoordinateSystem = SVG_TEXT_SELECTORS.some((target) => selector.includes(target));
      if (!inSvgCoordinateSystem) {
        found.push(
          violation("offscale-font-size", file, declaration, line, `${selector} → ${fontSize[1]}px 不在级差表内，见 docs/design-system/foundations.md#2-字体排版`),
        );
      }
    }

    // 字体栈必须走 --f-display / --f-ui / --f-mono / --f-head / --f-editorial。
    // design-tokens.css 的 @font-face 本身就是字族的定义处，豁免。
    const fontFamily = declaration.match(/^font-family:\s*(.+?)(?:\s*!important)?$/);
    if (!isTokenFile && fontFamily && !fontFamily[1].includes("var(")) {
      found.push(
        violation("raw-font-stack", file, declaration, line, `${selector} → 硬编码字体栈，请改用 var(--f-*)，见 docs/design-system/foundations.md#2-字体排版`),
      );
    }

    // `box-shadow: none` 是契约鼓励的复位写法，不算违规。
    if (declaration.startsWith("box-shadow") && !/^box-shadow:\s*none\b/.test(declaration)) {
      found.push(violation("box-shadow", file, declaration, line, `${selector} → box-shadow 需核定用途，见 docs/design-system/foundations.md#5-层次`));
    }

    const isReducedMotionOverride =
      collapse(selector) === GLOBAL_REDUCED_MOTION_SELECTOR &&
      REDUCED_MOTION_IMPORTANT_DECLARATIONS.has(declaration);
    if (declaration.includes("!important") && !isReducedMotionOverride) {
      found.push(violation("important", file, declaration, line, `${selector} → !important，见 docs/design-system/foundations.md#6-动效 与 docs/backlog.md`));
    }
  });

  walkMediaQueries(source, (prelude, feature, value, line) => {
    if (!BREAKPOINTS[feature].has(value)) {
      found.push(
        violation(
          "offscale-breakpoint",
          file,
          `${feature}:${value}px`,
          line,
          `${prelude} → ${value}px 不在规范四档（0 / 640 / 1024 / 1200），见 docs/design-system/patterns.md#响应式`,
        ),
      );
    }
  });

  return found;
}

function lintSource(file, source) {
  const found = [];
  for (const match of source.matchAll(/fontSize:\s*(\d+)/g)) {
    const value = Number(match[1]);
    if (!TYPE_SCALE.has(value)) {
      found.push(
        violation("offscale-font-size", file, `fontSize: ${value}`, lineAt(source, match.index), `内联 fontSize: ${value} 不在级差表内，见 docs/design-system/foundations.md#2-字体排版`),
      );
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// 收集文件
// ---------------------------------------------------------------------------

function listCss(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listCss(path) : entry.name.endsWith(".css") ? [path] : [];
  });
}
const cssFiles = listCss(CSS_DIR).sort();

function listSources(directory) {
  const result = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) result.push(...listSources(path));
    else if (name.endsWith(".tsx") || name.endsWith(".ts")) result.push(path);
  }
  return result;
}

const sourceFiles = SOURCE_ROOTS.flatMap(listSources).sort();

// ---------------------------------------------------------------------------
// 未定义的设计 token
// ---------------------------------------------------------------------------

/**
 * `var(--foo)` 指向一个不存在的变量时，浏览器不会报错：
 *   - 没有回退值时，整条声明被丢弃，元素悄悄退回继承值；
 *   - 有回退值时（`var(--foo, 0.2s)`），回退值生效，token 形同虚设——
 *     等于把 0.2s 这个裸值藏在 fallback 里，仍然是绕过 token 契约。
 * 本仓库里两种都出现过：`var(--r-technical)` 从未定义且无回退，
 * `var(--dur, 0.2s)` 从未定义但靠回退值活着。这条规则跨文件比对引用与定义。
 *
 * 定义可以来自三处：CSS 里的 `--x:`、TSX 内联样式对象里的 `"--x":`、以及 `setProperty("--x", …)`。
 */
const TOKEN_REFERENCE = /var\(\s*(--[a-zA-Z0-9_-]+)\s*(,)?/g;
const CSS_TOKEN_DEFINITION = /(--[a-zA-Z0-9_-]+)\s*:/g;
const JS_TOKEN_DEFINITION = /["'](--[a-zA-Z0-9_-]+)["']\s*:/g;
const JS_SET_PROPERTY = /setProperty\(\s*["'](--[a-zA-Z0-9_-]+)["']/g;

/** 宿主或浏览器注入的变量，不归本仓库定义。 */
const EXTERNAL_TOKEN_PREFIXES = ["--tw-", "--radix-", "--sb-", "--playwright-"];

const allSourceFiles = listSources("src").sort();

function collectDefinedTokens() {
  const defined = new Set();
  for (const match of tokensSource.matchAll(/@import "(@radix-ui\/colors\/[^" ]+\.css)"/g)) {
    const palette = readFileSync(require.resolve(match[1]), "utf8");
    for (const definition of palette.matchAll(CSS_TOKEN_DEFINITION)) defined.add(definition[1]);
  }
  for (const file of [...cssFiles, ...allSourceFiles]) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(file.endsWith(".css") ? CSS_TOKEN_DEFINITION : JS_TOKEN_DEFINITION)) {
      defined.add(match[1]);
    }
    for (const match of source.matchAll(JS_SET_PROPERTY)) defined.add(match[1]);
  }
  return defined;
}

const DEFINED_TOKENS = collectDefinedTokens();

function lintTokenReferences(file, source) {
  const found = [];
  for (const match of source.matchAll(TOKEN_REFERENCE)) {
    const name = match[1];
    if (DEFINED_TOKENS.has(name)) continue;
    if (EXTERNAL_TOKEN_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    const hasFallback = match[2] === ",";
    found.push(
      violation(
        "undefined-design-token",
        file,
        name,
        lineAt(source, match.index),
        hasFallback
          ? `var(${name}) 无定义，目前靠 fallback 值生效 —— 回退值是绕过 token 契约的裸值`
          : `var(${name}) 无定义且没有 fallback，浏览器会丢弃整条声明，元素退回继承值`,
      ),
    );
  }
  return found;
}

const violations = [
  ...cssFiles.flatMap((file) => lintCss(file, readFileSync(file, "utf8"))),
  ...sourceFiles.flatMap((file) => lintSource(file, readFileSync(file, "utf8"))),
  ...cssFiles.flatMap((file) => lintTokenReferences(file, readFileSync(file, "utf8"))),
  ...allSourceFiles.flatMap((file) => lintTokenReferences(file, readFileSync(file, "utf8"))),
];

// ---------------------------------------------------------------------------
// 与基线比对
// ---------------------------------------------------------------------------

const signature = (item) => `${item.rule}|${item.file}|${item.key}`;

const current = new Map();
for (const item of violations) current.set(signature(item), (current.get(signature(item)) ?? 0) + 1);

if (process.argv.includes("--update")) {
  const baseline = {
    $comment:
      "设计 token 守门脚本的存量基线。签名格式为 <规则>|<文件>|<规范化声明文本>，不含行号，因此挪动或重排代码不会产生误报。" +
      "用 `pnpm design:lint -- --update` 重建。数量下降时脚本会提示可收紧。现行规则见 DESIGN.md，待处理差异见 docs/backlog.md。",
    $generatedBy: "scripts/lint-design-tokens.mjs",
    counts: Object.fromEntries([...current.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
  writeFileSync(BASELINE_FILE, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`基线已重建：${BASELINE_FILE}`);
  console.log(`  命中 ${violations.length} 处 · 内容签名 ${current.size} 条`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
} catch {
  console.error(`读不到基线 ${BASELINE_FILE}。请先运行：pnpm design:lint -- --update`);
  process.exit(1);
}

const allowed = baseline.counts ?? {};
const added = [];
const relaxed = [];
let newTotal = 0;
let baseTotal = 0;

for (const key of new Set([...current.keys(), ...Object.keys(allowed)])) {
  const now = current.get(key) ?? 0;
  const before = allowed[key] ?? 0;
  baseTotal += Math.min(now, before);
  if (now > before) {
    added.push({ key, now, before });
    newTotal += now - before;
  } else if (now < before) {
    relaxed.push({ key, now, before });
  }
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------

const ruleCounts = new Map();
for (const item of violations) ruleCounts.set(item.rule, (ruleCounts.get(item.rule) ?? 0) + 1);

const hitSummary = [...ruleCounts.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([rule, count]) => `${rule} ${count}`)
  .join(" · ");

console.log("设计 token 守门");
console.log(`  扫描 ${cssFiles.length} 个 CSS · ${sourceFiles.length} 个 TS/TSX · 级差表 ${TYPE_SCALE.size} 档（现读自 ${TOKENS_FILE}）`);
console.log(`  命中 ${hitSummary || "（无）"}`);
console.log(`  基线内 ${baseTotal} 处 · 新增 ${newTotal} 处`);

if (added.length) {
  console.log("");
  console.log("新增违规 — 基线之外，必须处理：");
  for (const { key, now, before } of added) {
    const [rule, file, text] = key.split("|");
    const samples = violations.filter((item) => signature(item) === key);
    console.log(`  [${rule}] ${file}:${samples.map((item) => item.line).join(", ")}`);
    console.log(`      ${text}`);
    console.log(`      ${samples[0].message}`);
    console.log(`      基线允许 ${before} 处，实际 ${now} 处`);
  }
}

if (relaxed.length) {
  const label = process.argv.includes("--verbose") ? "基线可收紧" : "基线可收紧（加 --verbose 看明细）";
  console.log("");
  console.log(`${label}：${relaxed.length} 条`);
  if (process.argv.includes("--verbose")) {
    for (const { key, now, before } of relaxed) {
      const [rule, file, text] = key.split("|");
      console.log(`  [${rule}] ${file} ${text}  ${before} → ${now}`);
    }
  }
}

console.log("");
if (added.length) {
  console.log(`校验未通过：${newTotal} 处新增违反设计契约。`);
  console.log("请先按 DESIGN.md 核对所属规范与 docs/backlog.md 中的差异；不要为通过检查放宽基线。");
  process.exit(1);
}
console.log("校验通过：没有出现基线之外的新增裸值。");
