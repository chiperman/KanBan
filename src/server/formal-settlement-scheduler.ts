import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { FormalSettlementScheduler, FormalSettlementSchedulerStatus } from "@/server/ports";

const label = "com.xiaox.kanban.formal-daily-settlement";
const execute = promisify(execFile);
interface Instance { workspace: string; dataDir: string }

/** Only the loaded job's runtime description is evidence, not a potentially stale plist. */
export function matchesSettlementInstance(output: string, instance: Instance): boolean {
  const workingDirectories = [...output.matchAll(/^\s*working directory = (.+)$/gm)];
  if (workingDirectories.length !== 1) return false;
  const workingDirectory = workingDirectories[0][1].trim();
  if (!path.isAbsolute(workingDirectory) || path.resolve(workingDirectory) !== path.resolve(instance.workspace)) return false;
  const argumentsBlock = /^\s*arguments = \{\n([\s\S]*?)^\s*\}/m.exec(output)?.[1];
  if (!argumentsBlock?.split("\n").some((line) => line.trim() === path.join(instance.workspace, "scripts/run-formal-daily-settlement.ts"))) return false;
  const dataDirectories = [...output.matchAll(/^\s*KANBAN_DATA_DIR => (.*)$/gm)].map((match) => match[1].trim());
  // Without a complete environment description the default cannot be established.
  if (dataDirectories.length === 0 && (!/^\s*inherited environment = \{/m.test(output) || !/^\s*environment = \{/m.test(output))) return false;
  const effectiveDirectories = dataDirectories.length ? dataDirectories : ["data"];
  return effectiveDirectories.every((value) => path.resolve(workingDirectory, value || "data") === path.resolve(instance.workspace, instance.dataDir));
}
interface Probe {
  platform: string;
  now(): Date;
  hasPlist(): Promise<boolean>;
  query(): Promise<"loaded" | "absent" | "failed">;
}

/** Read-only, bounded observation; never bootstrap, kickstart or collect. */
export class LocalFormalSettlementScheduler implements FormalSettlementScheduler {
  constructor(private readonly probe: Probe = {
    platform: process.platform,
    now: () => new Date(),
    async hasPlist() {
      try {
        return (await stat(path.join(homedir(), "Library/LaunchAgents", label + ".plist"))).isFile();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    },
    async query() {
      if (!process.getuid) return "failed";
      try {
        const { stdout } = await execute("/bin/launchctl", ["print", "gui/" + process.getuid() + "/" + label], {
          timeout: 1500, maxBuffer: 64 * 1024, encoding: "utf8",
        });
        // A same-label job for another checkout is not evidence for this instance.
        return matchesSettlementInstance(stdout, instance)
          ? "loaded" : "failed";
      } catch (error) {
        const failure = error as { code?: number; stderr?: string; killed?: boolean };
        return !failure.killed && failure.code === 113 && /Could not find service/.test(failure.stderr ?? "")
          ? "absent" : "failed";
      }
    },
  }, instance: Instance = { workspace: process.cwd(), dataDir: process.env.KANBAN_DATA_DIR?.trim() || "data" }) {}

  async read(): Promise<FormalSettlementSchedulerStatus> {
    const checkedAt = this.probe.now().toISOString();
    if (this.probe.platform !== "darwin") return { state: "unsupported", checkedAt };
    try {
      const [hasPlist, loaded] = await Promise.all([this.probe.hasPlist(), this.probe.query()]);
      return { checkedAt, state: loaded === "loaded" ? "loaded" : loaded === "failed" ? "query-failed" : hasPlist ? "not-loaded" : "plist-missing" };
    } catch {
      return { state: "query-failed", checkedAt };
    }
  }
}
