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

for (const ready of [false, true]) {
  test("真实 CLI 确定性手工来源：" + (ready ? "采集窗口" : "窗口未到"), async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kanban-cli-window-"));
    try {
      const preload = path.join(root, "clock.mjs");
      const time = ready ? "2026-08-05T16:06:00.000Z" : "2026-08-05T16:01:00.000Z";
      const productionUrl = pathToFileURL(path.join(workspace, "src/server/production.ts")).href;
      const runnerUrl = pathToFileURL(path.join(workspace, "src/server/formal-daily-settlement.ts")).href;
      await writeFile(preload, [
        'const { createProductionServices } = await import(' + JSON.stringify(productionUrl) + ');',
        'const services = createProductionServices(); await services.manualAssetRecords.create({label:"CLI样例"});',
        'const [source] = await services.assetSources.list(); await services.manualAssetRecords.record(source.id,{day:"2026-08-05",amount:"1",currency:"USD"});',
        'const { MarketCloseFormalDailySettlement } = await import(' + JSON.stringify(runnerUrl) + ');',
        'const run = MarketCloseFormalDailySettlement.prototype.run; MarketCloseFormalDailySettlement.prototype.run = function () { this.clock = {now:()=>new Date(' + JSON.stringify(time) + ')}; return run.call(this); };',
      ].join("\n"));
      const env = { ...process.env, APP_ENV: "production", KANBAN_DATA_DIR: root, LONGBRIDGE_OAUTH_CLIENT_ID: "isolated-test", PAD_SECRET_ENCRYPTION_KEY: randomBytes(32).toString("base64") };
      const result = await execute(process.execPath, ["--experimental-transform-types", "--import", "./scripts/register-ts-alias.mjs", "--import", preload, "./scripts/run-formal-daily-settlement.ts"], { cwd: workspace, env });
      const value = JSON.parse(result.stdout);
      assert.equal(value.outcome, ready ? "recorded" : "not-due");
      if (ready) assert.equal(value.settlementStatus, "incomplete");
      else assert.equal(value.reason, "before-window");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test("launchd 仅打印的命令与真实 CLI 模块加载参数一致", async () => {
  const { stdout } = await execute(process.execPath, ["scripts/formal-daily-settlement-launchd.mjs", "print"]);
  const block = stdout.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/)[1];
  const args = [...block.matchAll(/<string>(.*?)<\/string>/g)].map((match) => match[1]);
  assert.deepEqual(args, [process.execPath, "--experimental-transform-types", "--import", path.join(workspace, "scripts/register-ts-alias.mjs"), path.join(workspace, "scripts/run-formal-daily-settlement.ts")]);
});
