#!/usr/bin/env node
/**
 * 在真实浏览器中验收生成的设计规范样式指南。
 *
 * 校验：字体真加载、点场混合模式、明暗主题 token 生效、组件交互、计数动画落位、
 * 移动端无横向溢出、控制台无错误。截图输出到 tmp/styleguide-verify/。
 *
 * 用法：pnpm design:styleguide:verify
 */

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";

const STYLEGUIDE = "docs/design-system/styleguide.html";
const OUT_DIR = "tmp/styleguide-verify";
const THEME = { dark: "#000000", light: "#f2f2f2" };

mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});

const consoleErrors = [];
const pageErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => pageErrors.push(String(error)));

await page.goto(pathToFileURL(resolve(STYLEGUIDE)).href, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(600);

const computed = (selector, property) =>
  page.evaluate(
    ({ sel, prop }) => {
      const element = document.querySelector(sel);
      return element ? getComputedStyle(element)[prop] : null;
    },
    { sel: selector, prop: property },
  );

const report = {
  sections: await page.locator(".sg-section").count(),
  panels: await page.locator(".sg-panel").count(),
  swatches: await page.locator(".sg-swatch").count(),
  lineIcons: await page.locator(".vibe-icon").count(),
  dotGlyphCells: await page.locator(".vibe-dot-icon > span").count(),
  statusTags: await page.locator(".vibe-status-tag").count(),
  loadedFaces: await page.evaluate(() => [
    ...new Set([...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family)),
  ]),
  // design-tokens.css 声明了 6 个 @font-face（Doto ×1、Geist ×2、Geist Mono ×2、Newsreader ×1）。
  // 这里逐面校验，防止新增字重被静默漏嵌。
  loadedFaceCount: await page.evaluate(
    () => [...document.fonts].filter((f) => f.status === "loaded").length,
  ),
  declaredFaceCount: await page.evaluate(() =>
    [...document.styleSheets].reduce(
      (total, sheet) => {
        let rules;
        try {
          rules = sheet.cssRules;
        } catch {
          return total;
        }
        return (
          total +
          [...rules].filter((rule) => rule instanceof CSSFontFaceRule).length
        );
      },
      0,
    ),
  ),
  displayFont: await computed(".sg-specimen-doto", "fontFamily"),
  monoFont: await computed(".sg-specimen-mono", "fontFamily"),
  editorialFont: await computed(".sg-specimen-editorial", "fontFamily"),
  panelRadius: await computed(".sg-panel", "borderRadius"),
  panelShadow: await computed(".sg-panel", "boxShadow"),
  dotFieldBlend: await page.evaluate(
    () => getComputedStyle(document.body, "::before").mixBlendMode,
  ),
  dotFieldSize: await page.evaluate(
    () => getComputedStyle(document.body, "::before").backgroundSize,
  ),
};

// 主题切换：token 必须实时重算
const themes = {};
for (const [name, expectedBg] of Object.entries(THEME)) {
  await page.click(`[data-sg-theme="${name}"]`);
  await page.waitForTimeout(350);
  themes[name] = {
    applied: await page.evaluate(() => document.documentElement.dataset.theme),
    bg: await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
    ),
    expectedBg,
  };
  await page.screenshot({ path: `${OUT_DIR}/${name}-full.png`, fullPage: true });
}
await page.click('[data-sg-theme="dark"]');
await page.waitForTimeout(300);

// 对话框：打开、Esc 关闭
await page.click("[data-sg-open-dialog]");
await page.waitForTimeout(250);
const dialogOpened = await page.isVisible("#sg-dialog-overlay");
await page.screenshot({ path: `${OUT_DIR}/dialog.png` });
await page.keyboard.press("Escape");
await page.waitForTimeout(250);
const dialogClosed = await page.locator("#sg-dialog-overlay").isHidden();

// 下拉菜单
await page.click(".vibe-menu__trigger");
await page.waitForTimeout(250);
const menuOpened = await page.isVisible(".vibe-menu__panel");
await page.keyboard.press("Escape");

// 验证码槽位与真实输入同步
await page.click("#sg-code");
await page.keyboard.type("428913");
await page.waitForTimeout(200);
const codeSlots = await page.evaluate(() =>
  [...document.querySelectorAll("[data-sg-slot]")].map((slot) => slot.textContent).join(""),
);

// 计数动画：滚动进入视口后才启动，最终必须落位到目标值
await page.locator(".vibe-live-counter[data-sg-count]").scrollIntoViewIfNeeded();
await page.waitForTimeout(2200);
const counter = await page.evaluate(() => {
  const node = document.querySelector(".vibe-live-counter[data-sg-count]");
  return { text: node.textContent, state: node.dataset.counterState, target: node.dataset.counterTarget };
});

// 移动端：文档宽度必须等于视口宽度
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(500);
const mobile = await page.evaluate(() => {
  const offenders = [];
  for (const element of document.querySelectorAll("body *")) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.right > window.innerWidth + 1) {
      offenders.push(
        `${element.tagName.toLowerCase()}.${String(element.className).split(" ")[0]} → ${Math.round(rect.right)}px`,
      );
    }
  }
  return { scrollWidth: document.documentElement.scrollWidth, offenders: [...new Set(offenders)] };
});
await page.screenshot({ path: `${OUT_DIR}/mobile.png`, fullPage: true });

await browser.close();

console.log(
  JSON.stringify({ ...report, themes, dialogOpened, dialogClosed, menuOpened, codeSlots, counter, mobile, consoleErrors, pageErrors }, null, 2),
);

const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

expect(report.sections === 10, `章节数 ${report.sections}，期望 10`);
expect(report.panels > 40, `面板数偏少：${report.panels}`);
expect(report.swatches === 25, `色板数 ${report.swatches}，期望 25`);
expect(report.lineIcons === 12, `线形图标数 ${report.lineIcons}，期望 12`);
expect(
  report.loadedFaceCount === report.declaredFaceCount,
  `字体面加载不全：已加载 ${report.loadedFaceCount} / 已声明 ${report.declaredFaceCount}`,
);
expect(report.declaredFaceCount === 6, `@font-face 声明数 ${report.declaredFaceCount}，期望 6`);
for (const role of ["Doto", "Geist", "Geist Mono", "Newsreader"]) {
  expect(report.loadedFaces.includes(role), `字族未加载：${role}`);
}
expect(report.displayFont.includes("Doto"), `主数字未使用 Doto：${report.displayFont}`);
expect(report.monoFont.includes("Geist Mono"), `标签未使用 Geist Mono：${report.monoFont}`);
expect(report.editorialFont.includes("Newsreader"), `编辑体未使用 Newsreader：${report.editorialFont}`);
expect(report.panelShadow === "none", `面板出现 box-shadow：${report.panelShadow}`);
expect(report.panelRadius === "8px", `面板圆角 ${report.panelRadius}，期望 8px`);
expect(report.dotFieldBlend === "difference", `点场混合模式 ${report.dotFieldBlend}，期望 difference`);
expect(report.dotFieldSize === "120px 120px", `点场间距 ${report.dotFieldSize}，期望 120px 120px`);

for (const [name, value] of Object.entries(themes)) {
  expect(value.applied === name, `${name} 主题未生效`);
  expect(
    value.bg === value.expectedBg,
    `${name} 主题 --bg = ${value.bg}，期望 ${value.expectedBg}`,
  );
}

expect(dialogOpened && dialogClosed, "对话框开关异常");
expect(menuOpened, "下拉菜单未展开");
expect(codeSlots === "428913", `验证码槽位未与输入同步：${codeSlots}`);
expect(counter.state === "complete", `计数动画未落位：${counter.state}`);
expect(counter.text === counter.target, `计数值 ${counter.text} ≠ 目标 ${counter.target}`);
expect(mobile.scrollWidth <= 390, `移动端横向溢出：${mobile.scrollWidth}px`);
expect(mobile.offenders.length === 0, `移动端越界元素：${mobile.offenders.join(" | ")}`);
expect(pageErrors.length === 0, `页面异常：${pageErrors.join(" | ")}`);
expect(consoleErrors.length === 0, `控制台错误：${consoleErrors.join(" | ")}`);

if (failures.length) {
  console.log("\n验收未通过：");
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}

console.log("\n验收通过：字体 / 点场 / 双主题 token / 组件交互 / 计数动画 / 移动端布局 / 控制台 均正常。");
