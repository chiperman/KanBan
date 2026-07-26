import { readFile } from "node:fs/promises";

for await (const _chunk of process.stdin) {
  // 先完整读取普通输入，模拟 worker 已正常启动。
}
await readFile("/dev/fd/3", "utf8");
process.stdout.write("{invalid-json");
