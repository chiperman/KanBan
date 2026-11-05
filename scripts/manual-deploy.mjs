import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const [sha] = process.argv.slice(2);
if (!sha || !/^[0-9a-f]{7,40}$/i.test(sha)) {
  throw new Error("用法：pnpm deploy:manual <已通过 main CI 的 commit SHA>");
}
if (process.platform !== "darwin") throw new Error("正式版手动部署仅支持 macOS");

const source = path.resolve(process.cwd());
if (!existsSync(path.join(source, ".git"))) throw new Error("请在 KanBan 仓库根目录执行手动部署");
const root = path.join(homedir(), "Library/Application Support/KanBan/manual-deploy");
const worktree = path.join(root, "worktrees", `${sha.slice(0, 12)}-${Date.now()}`);
mkdirSync(path.dirname(worktree), { recursive: true, mode: 0o700 });

function git(args) {
  return execFileSync("git", args, { cwd: source, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}
function run(executable, args) {
  execFileSync(executable, args, { cwd: worktree, stdio: "inherit" });
}

git(["fetch", "--prune", "origin", "main"]);
const resolved = git(["rev-parse", `${sha}^{commit}`]);
try {
  execFileSync("git", ["merge-base", "--is-ancestor", resolved, "origin/main"], { cwd: source, stdio: "ignore" });
} catch {
  throw new Error("无法确认目标提交属于 origin/main");
}
execFileSync("git", ["worktree", "add", "--detach", worktree, resolved], { cwd: source, stdio: "inherit" });
try {
  console.log(`准备部署 ${resolved}；正式环境只会更新到这个固定提交。`);
  run("pnpm", ["runtime:update"]);
  console.log(`手动部署完成：${resolved}`);
} finally {
  try { execFileSync("git", ["worktree", "remove", "--force", worktree], { cwd: source, stdio: "inherit" }); }
  finally { rmSync(worktree, { recursive: true, force: true }); }
}
