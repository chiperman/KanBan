import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

export async function bootstrapLaunchAgent(domain, file) {
  // bootout 返回后，launchd 可能仍在清理旧任务，暂时拒绝同名任务。
  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      execFileSync("/bin/launchctl", ["bootstrap", domain, file], { stdio: ["ignore", "pipe", "pipe"] });
      return;
    } catch (error) {
      if (error.status !== 5 || Date.now() >= deadline) throw error;
      await delay(1000);
    }
  }
}
