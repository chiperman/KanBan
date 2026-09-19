import assert from "node:assert/strict";
import test from "node:test";
import { LocalFormalSettlementScheduler, matchesSettlementInstance } from "@/server/formal-settlement-scheduler";
const now = () => new Date("2026-09-18T00:00:00.000Z");
const workspace = "/tmp/kanban-fixture";
function job(directory = workspace, environment = "") {
  return `job = {
    arguments = {
      /usr/bin/node
      ${workspace}/scripts/run-formal-daily-settlement.ts
    }
    working directory = ${directory}
    inherited environment = {
    }
    environment = {
      ${environment}
    }
  }`;
}
for (const [name, output, dataDir, expected] of [
  ["same default database", job(), workspace + "/data", true],
  ["different WorkingDirectory", job("/tmp/other"), workspace + "/data", false],
  ["different explicit database", job(workspace, "KANBAN_DATA_DIR => /tmp/other-db"), workspace + "/data", false],
  ["same explicit database", job(workspace, "KANBAN_DATA_DIR => /tmp/isolated-db"), "/tmp/isolated-db", true],
  ["relative database", job(workspace, "KANBAN_DATA_DIR => isolated-db"), workspace + "/isolated-db", true],
  ["app custom database job default", job(), "/tmp/isolated-db", false],
  ["environment unknown", job().replace("inherited environment", "unrecognized environment"), workspace + "/data", false],
  ["script path alone", workspace + "/scripts/run-formal-daily-settlement.ts", workspace + "/data", false],
  ["ambiguous inherited override", job(workspace, "KANBAN_DATA_DIR => /tmp/isolated-db\nKANBAN_DATA_DIR => /tmp/other-db"), "/tmp/isolated-db", false],
] as const) {
  test("任务归属：" + name, () => assert.equal(matchesSettlementInstance(output, { workspace, dataDir }), expected));
}
for (const [platform, plist, query, expected] of [
  ["linux", true, "loaded", "unsupported"],
  ["darwin", false, "absent", "plist-missing"],
  ["darwin", true, "absent", "not-loaded"],
  ["darwin", true, "loaded", "loaded"],
  ["darwin", false, "loaded", "loaded"],
  ["darwin", true, "failed", "query-failed"],
  ["darwin", false, "failed", "query-failed"],
] as const) {
  test("调度探测 " + [platform, plist, query].join("/") + " → " + expected, async () => {
    const probe = new LocalFormalSettlementScheduler({ platform, now, hasPlist: async () => plist, query: async () => query });
    assert.deepEqual(await probe.read(), { state: expected, checkedAt: now().toISOString() });
  });
}
test("文件探测异常也为未知，不误判缺配置", async () => {
  const probe = new LocalFormalSettlementScheduler({ platform: "darwin", now, hasPlist: async () => { throw new Error("private path"); }, query: async () => "loaded" });
  assert.equal((await probe.read()).state, "query-failed");
});
