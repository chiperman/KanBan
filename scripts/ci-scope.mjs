import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const fullScope = () => ({ app: true, native: true });
const documentationOnly = file =>
  file.startsWith("docs/") || file.startsWith("landing/") ||
  /^[^/]+\.md$/.test(file) || file === "LICENSE";
const nativeInput = file =>
  /^(plugins\/longbridge\/(native\/|build-native\.mjs$|native-artifact\.mjs$)|scripts\/(build-longbridge-keychain-sdk\.mjs$|native-artifact\.mjs$|check-toolchain\.mjs$|ci-scope\.mjs$)|\.github\/workflows\/native\.yml$|package\.json$|pnpm-lock\.yaml$|\.node-version$)/.test(file);

/** Unknown events, missing history and failed diffs must run all checks. */
export function ciScope({ root = process.cwd(), environment = process.env } = {}) {
  if (!["pull_request", "push"].includes(environment.GITHUB_EVENT_NAME) || !environment.GITHUB_EVENT_PATH) return fullScope();
  try {
    const event = JSON.parse(readFileSync(environment.GITHUB_EVENT_PATH, "utf8"));
    const base = environment.GITHUB_EVENT_NAME === "pull_request" ? event.pull_request?.base?.sha : event.before;
    if (!/^[a-f0-9]{40}$/.test(base ?? "") || /^0+$/.test(base)) return fullScope();
    const diff = spawnSync("git", ["diff", "--no-renames", "--name-only", "-z", base, "HEAD"], { cwd: root, encoding: "utf8" });
    if (diff.error || diff.status !== 0) return fullScope();
    const files = diff.stdout.split("\0").filter(Boolean);
    return {
      // Main pushes always keep a complete application verification.
      app: environment.GITHUB_EVENT_NAME !== "pull_request" || files.some(file => !documentationOnly(file)),
      native: files.some(nativeInput),
    };
  } catch {
    return fullScope();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const scope = ciScope();
  const output = Object.entries(scope).map(([key, value]) => `${key}=${value}`).join("\n") + "\n";
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
  process.stdout.write(output);
}
