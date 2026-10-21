import { spawn } from "node:child_process";
import path from "node:path";
import { readFileSync } from "node:fs";
import { checkToolchain } from "./check-toolchain.mjs";
import { checkNativeArtifact } from "./native-artifact.mjs";
import { resolveNodeNetworkEnvironment } from "./local-network-environment.mjs";

checkToolchain();
checkNativeArtifact();
try { process.loadEnvFile(path.resolve(".env.local")); }
catch (error) { if (error.code !== "ENOENT") throw error; }
if (process.env.APP_ENV === "test") throw new Error("后台生产采集不能使用 APP_ENV=test");
if (!process.env.KANBAN_DATA_DIR || !path.isAbsolute(process.env.KANBAN_DATA_DIR)) throw new Error("后台采集必须显式设置绝对路径 KANBAN_DATA_DIR");
// 更新仅暂停新批次；已有进程继续完成。更新进程意外退出后不留下永久暂停。
try {
  const { pid } = JSON.parse(readFileSync(path.join(process.env.KANBAN_DATA_DIR, ".runtime-update-pause"), "utf8"));
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("无效的更新进程");
  process.kill(pid, 0);
  process.exit(0);
} catch (error) {
  if (!["ENOENT", "ESRCH"].includes(error.code)) throw error;
}
const { env } = await resolveNodeNetworkEnvironment(process.env);
const child = spawn(process.execPath, ["--experimental-transform-types", "--import", "./scripts/register-ts-alias.mjs", "./scripts/run-background-collection.ts"], {
  cwd: process.cwd(), env, stdio: "inherit",
});
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
child.on("error", () => { process.stderr.write("后台采集进程启动失败。\n"); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
