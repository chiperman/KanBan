import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const SCRIPT = path.join(process.cwd(), "scripts", "longbridge-keychain.mjs");
const START_SCRIPT = path.join(process.cwd(), "scripts", "run-local-next.mjs");

function fakeSecurity(ready) {
  const directory = mkdtempSync(path.join(tmpdir(), "kanban-keychain-"));
  const log = path.join(directory, "security.log");
  const executable = path.join(directory, "security");
  writeFileSync(
    executable,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$SECURITY_LOG"
if [ "$1" = "show-keychain-info" ] && [ "$FAKE_KEYCHAIN_READY" != "1" ]; then
  echo "The user name or passphrase you entered is not correct." >&2
  exit 51
fi
exit 0
`,
  );
  chmodSync(executable, 0o755);
  return {
    env: {
      ...process.env,
      FAKE_KEYCHAIN_READY: ready ? "1" : "0",
      HOME: directory,
      LONGBRIDGE_OAUTH_CLIENT_ID: "test-client",
      PATH: `${directory}:${process.env.PATH ?? ""}`,
      SECURITY_LOG: log,
    },
    log,
  };
}

test("Keychain 检查失败时给出统一修复命令", () => {
  const fixture = fakeSecurity(false);
  const result = spawnSync(process.execPath, [SCRIPT, "check"], {
    encoding: "utf8",
    env: fixture.env,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /pnpm longbridge:keychain:repair/);
});

test("Keychain 修复命令依次锁定、解锁并验证 login 钥匙串", () => {
  const fixture = fakeSecurity(true);
  const result = spawnSync(process.execPath, [SCRIPT, "repair"], {
    encoding: "utf8",
    env: fixture.env,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /长桥 Keychain 已恢复/);
  assert.deepEqual(
    readFileSync(fixture.log, "utf8").trim().split("\n"),
    [
      `lock-keychain ${fixture.env.HOME}/Library/Keychains/login.keychain-db`,
      `unlock-keychain ${fixture.env.HOME}/Library/Keychains/login.keychain-db`,
      `show-keychain-info ${fixture.env.HOME}/Library/Keychains/login.keychain-db`,
    ],
  );
});

test("CLI 启动不检查或修复 SDK Keychain", async () => {
  const fixture = fakeSecurity(false);
  const occupied = createServer();
  await new Promise((resolve, reject) => {
    occupied.once("error", reject);
    occupied.listen(0, "127.0.0.1", resolve);
  });
  try {
    const port = occupied.address().port;
    const result = spawnSync(process.execPath, [START_SCRIPT, "dev", "--port", String(port)], {
      encoding: "utf8",
      env: fixture.env,
      timeout: 10_000,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /EADDRINUSE/);
    assert.equal(existsSync(fixture.log), false);
  } finally {
    await new Promise(resolve => occupied.close(resolve));
  }
});
