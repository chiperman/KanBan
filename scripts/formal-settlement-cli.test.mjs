import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
const execute = promisify(execFile);
const workspace = process.cwd();

for (const failed of [false, true]) {
  test(failed ? "CLI执行异常非零退出且页面组合根读取同一临时目录" : "CLI空来源零退出且未写正式日结", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kanban-cli-isolated-"));
    try {
      const preload = path.join(root, "preload.mjs");
      // Fake runner only in this child process; production composition/storage/CLI remain real.
      await writeFile(preload, failed ?
        'const { MarketCloseFormalDailySettlement } = await import(' + JSON.stringify(pathToFileURL(path.join(workspace, "src/server/formal-daily-settlement.ts")).href) + '); MarketCloseFormalDailySettlement.prototype.run = async function () { throw new Error("PRIVATE_CLI_TOKEN"); };' : "");
      const env = { ...process.env, APP_ENV: "production", KANBAN_DATA_DIR: root, LONGBRIDGE_OAUTH_CLIENT_ID: "isolated-test-client", LONGBRIDGE_OAUTH_CALLBACK_PORT: "60355", PAD_SECRET_ENCRYPTION_KEY: randomBytes(32).toString("base64") };
      const args = ["--experimental-transform-types", "--import", "./scripts/register-ts-alias.mjs", "--import", preload, "./scripts/run-formal-daily-settlement.ts"];
      let output;
      try { output = { ...await execute(process.execPath, args, { cwd: workspace, env }), code: 0 }; }
      catch (error) { output = error; }
      assert.equal(output.code, failed ? 1 : 0, JSON.stringify({stdout: output.stdout, stderr: output.stderr}));
      assert.ok(!output.stderr.includes("PRIVATE_CLI_TOKEN"));
      assert.ok(!output.stdout.includes("PRIVATE_CLI_TOKEN"));
      assert.ok(output.stdout.trim(), output.stderr);
      const result = JSON.parse(output.stdout);
      assert.equal(result.outcome, failed ? "error" : "not-due");
      const reader = path.join(root, "read.mjs");
      await writeFile(reader, 'const { createProductionServices } = await import(' + JSON.stringify(pathToFileURL(path.join(workspace, "src/server/production.ts")).href) + '); const services = createProductionServices(); console.log(JSON.stringify({record:await services.formalSettlementExecutions.latest(), settlements:await services.formalDailySettlements.list()}));');
      const check = await execute(process.execPath, ["--experimental-transform-types", "--import", "./scripts/register-ts-alias.mjs", reader], { cwd: workspace, env });
      const observed = JSON.parse(check.stdout);
      assert.equal(observed.record.outcome, result.outcome);
      assert.equal(observed.record.reason, failed ? "execution-failed" : "no-sources");
      assert.deepEqual(observed.settlements, []);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
