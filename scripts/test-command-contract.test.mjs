import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const { scripts } = packageJson;

test("开发门禁、浏览器回归和串行排障命令保持分层", () => {
  assert.equal(
    scripts.test,
    "pnpm typecheck && pnpm test:unit && pnpm test:smoke",
  );
  assert.equal(
    scripts["test:browser"],
    "pnpm test:browser:parallel && pnpm test:browser:production:parallel",
  );
  assert.equal(
    scripts["test:browser:serial"],
    "pnpm test:browser:test && pnpm test:browser:production",
  );
  assert.equal(scripts["test:regression"], "pnpm build && pnpm test:browser");
});
