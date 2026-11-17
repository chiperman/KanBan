import { readFileSync } from "node:fs";

const usage = "用法：pnpm release:check | pnpm --silent release:notes";
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function compareVersions(left, right) {
  const a = left.split(".").map(BigInt);
  const b = right.split(".").map(BigInt);
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function readRelease() {
  const { version } = JSON.parse(readFileSync("package.json", "utf8"));
  if (typeof version !== "string" || !versionPattern.test(version)) {
    throw new Error("package.json 的应用版本必须使用 X.Y.Z，数字不能有前导零。");
  }
  const changelog = readFileSync("CHANGELOG.md", "utf8").replace(/\r\n/g, "\n");
  const headings = [...changelog.matchAll(/^## (.+)$/gm)];
  if (!headings.length) throw new Error("CHANGELOG.md 缺少应用版本记录。");

  const releases = headings.map((heading, index) => {
    const match = /^\[([^\]]+)\] - (未发布|历史开发版本|\d{4}-\d{2}-\d{2})$/.exec(heading[1]);
    if (!match || !versionPattern.test(match[1])) {
      throw new Error(`更新日志标题格式错误：${heading[0]}；应为 ## [X.Y.Z] - 未发布 或 YYYY-MM-DD，历史章节可标为“历史开发版本”。`);
    }
    const [, entryVersion, date] = match;
    if (date === "未发布") {
      if (index !== 0) throw new Error("只有最新版本可以标为“未发布”。");
    } else if (date === "历史开发版本") {
      if (index === 0) throw new Error("当前应用版本不能标为“历史开发版本”，请使用“未发布”或实际发布日期。");
    } else {
      const timestamp = Date.parse(`${date}T00:00:00Z`);
      if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) {
        throw new Error(`${entryVersion} 的发布日期无效：${date}。`);
      }
    }
    const section = changelog.slice(heading.index, headings[index + 1]?.index).trim();
    if (!/^- \S/m.test(section)) throw new Error(`${entryVersion} 缺少更新条目。`);
    return { version: entryVersion, date, section };
  });

  for (let index = 1; index < releases.length; index++) {
    if (compareVersions(releases[index - 1].version, releases[index].version) <= 0) {
      throw new Error("CHANGELOG.md 的版本必须唯一，并按版本号从新到旧排列。");
    }
  }
  if (releases[0].version !== version) {
    throw new Error(`版本不一致：package.json 为 ${version}，更新日志最新版本为 ${releases[0].version}。`);
  }
  return releases[0];
}

try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && !["--notes", "--help"].includes(args[0]))) {
    throw new Error(usage);
  }
  if (args[0] === "--help") {
    console.log(`${usage}\n检查只读；导出发布说明前，最新版本必须填写实际发布日期。`);
  } else {
    const release = readRelease();
    if (args[0] === "--notes") {
      if (release.date === "未发布") {
        throw new Error(`v${release.version} 尚未填写发布日期；请在 CHANGELOG.md 中将“未发布”替换为实际发布日期，再导出发布说明。`);
      }
      process.stdout.write(`${release.section}\n`);
    } else {
      console.log(`版本检查通过：${release.version} / v${release.version}，更新日志状态：${release.date}。`);
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
