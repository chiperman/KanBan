import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import test from "node:test";

test("新进程和模块重载复用服务，重启保留业务状态", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kanban-services-"));
  try {
    const composition = pathToFileURL(path.join(process.cwd(), "src/server/composition.ts")).href;
    const child = path.join(root, "check.mjs");
    await writeFile(child, [
      'import assert from "node:assert/strict";',
      'const firstModule = await import(' + JSON.stringify(composition) + ');',
      'const services = firstModule.getServices();',
      'assert.equal(firstModule.getServices(), services);',
      'const reloaded = await import(' + JSON.stringify(composition + "?reload=1") + ');',
      'assert.equal(reloaded.getServices(), services);',
      'assert.equal(typeof services.assetSourceDetails.readSourceDetail, "function");',
      'if (process.argv[2] === "seed") await services.manualAssetRecords.create({label:"生命周期样例"});',
      'assert.equal((await services.assetSources.list()).length, 1);',
      'await services.secrets.get("missing");',
      'console.log("services-ok");',
    ].join("\n"));
    const env = { ...process.env, APP_ENV: "production", KANBAN_DATA_DIR: root, LONGBRIDGE_OAUTH_CLIENT_ID: "isolated-lifecycle", PAD_SECRET_ENCRYPTION_KEY: randomBytes(32).toString("base64") };
    for (const mode of ["seed", "restart"]) {
      const result = await promisify(execFile)(process.execPath, ["--experimental-transform-types", "--import", "./scripts/register-ts-alias.mjs", child, mode], { env });
      assert.equal(result.stdout.trim(), "services-ok");
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
