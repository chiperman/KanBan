import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = path.resolve(process.argv[2] || path.join(workspace, "dist/plugins/packages"));

// The application owns this directory. Rebuilding replaces only generated files;
// it never touches the user's data directory or installed credentials.
if (existsSync(destination)) rmSync(destination, { recursive: true, force: true });
execFileSync(process.execPath, [
  path.join(workspace, "scripts/build-source-plugins.mjs"),
  destination,
], { cwd: workspace, stdio: "inherit" });
