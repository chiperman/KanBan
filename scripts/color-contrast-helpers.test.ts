import assert from "node:assert/strict";
import test from "node:test";

import { contrastRatio, parseColor } from "../e2e/smoke/color-contrast-helpers";

test("computed RGB and normalized sRGB retain channel scale and alpha", () => {
  assert.deepEqual(parseColor("rgb(88, 90, 90)"), [88, 90, 90, 1]);
  assert.deepEqual(parseColor("rgba(88, 90, 90, 0.5)"), [88, 90, 90, 0.5]);
  assert.deepEqual(parseColor("rgb(100% 50% 0% / 50%)"), [255, 127.5, 0, 0.5]);
  assert.deepEqual(parseColor("color(srgb 1 0.5 0 / 9%)"), [255, 127.5, 0, 0.09]);
});

test("a translucent sRGB error surface preserves the real text contrast", () => {
  const ratio = contrastRatio("rgb(88, 90, 90)", [
    "color(srgb 0.823529 0.231373 0.188235 / 0.09)",
    "rgba(0, 0, 0, 0)",
    "rgb(255, 255, 255)",
  ]);
  assert.ok(ratio > 6 && ratio < 6.2);
});

test("nested translucent backgrounds paint outermost first", () => {
  const layered = contrastRatio("rgb(0, 0, 0)", [
    "rgba(255, 0, 0, 0.5)",
    "rgba(0, 0, 255, 0.5)",
    "transparent",
  ]);
  const flattened = contrastRatio("rgb(0, 0, 0)", ["rgb(191.25, 63.75, 127.5)"]);
  assert.equal(layered, flattened);
});

test("opaque and translucent text still enforce the readability threshold", () => {
  assert.equal(contrastRatio("rgb(0, 0, 0)", ["rgb(255, 255, 255)"]), 21);
  assert.ok(contrastRatio("rgb(88, 90, 90)", ["rgb(100, 100, 100)"]) < 4.5);
  assert.ok(contrastRatio("rgba(0, 0, 0, 0.1)", ["rgb(255, 255, 255)"]) < 4.5);
});

test("unsupported or invalid colors fail rather than bypass the contrast check", () => {
  assert.throws(() => parseColor("color(display-p3 1 0 0)"), /Unsupported/);
  assert.throws(() => parseColor("rgb(NaN, 0, 0)"), /Invalid/);
});
