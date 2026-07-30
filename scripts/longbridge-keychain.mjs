import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const LONGBRIDGE_KEYCHAIN_REPAIR_COMMAND =
  "pnpm longbridge:keychain:repair";

export function loginKeychainPath() {
  const home = process.env.HOME;
  if (!home) throw new Error("无法确定当前用户目录");
  return path.join(home, "Library", "Keychains", "login.keychain-db");
}

function runSecurity(args, stdio = "ignore") {
  return spawnSync("security", args, {
    stdio,
  }).status === 0;
}

export function checkLongbridgeKeychain() {
  return runSecurity(["show-keychain-info", loginKeychainPath()]);
}

export function repairLongbridgeKeychain() {
  const keychain = loginKeychainPath();
  if (!runSecurity(["lock-keychain", keychain], "inherit")) return false;
  if (!runSecurity(["unlock-keychain", keychain], "inherit")) return false;
  return runSecurity(["show-keychain-info", keychain], "inherit");
}

function failWithRepairCommand() {
  console.error(
    `macOS 登录钥匙串当前不可用，请运行 ${LONGBRIDGE_KEYCHAIN_REPAIR_COMMAND}`,
  );
  process.exitCode = 1;
}

function main() {
  const command = process.argv[2];
  if (command === "check") {
    if (checkLongbridgeKeychain()) {
      console.log("长桥 Keychain 可用");
      return;
    }
    failWithRepairCommand();
    return;
  }
  if (command === "repair") {
    if (repairLongbridgeKeychain()) {
      console.log("长桥 Keychain 已恢复");
      return;
    }
    failWithRepairCommand();
    return;
  }
  console.error("用法：node scripts/longbridge-keychain.mjs <check|repair>");
  process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main();
}
