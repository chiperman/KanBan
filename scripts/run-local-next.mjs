import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const [, , mode, ...nextArgs] = process.argv;
if (mode !== "dev" && mode !== "start") {
  throw new Error("本地 Next 启动模式必须是 dev 或 start");
}

const require = createRequire(import.meta.url);

function readPort(args) {
  let port = process.env.PORT ?? "3000";
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "-p" || argument === "--port") {
      port = args[index + 1] ?? "";
    } else if (argument.startsWith("--port=")) {
      port = argument.slice("--port=".length);
    }
  }

  const parsed = Number(port);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`无效的本地服务端口：${port}`);
  }
  return parsed;
}

const port = readPort(nextArgs);
const redirectServer = createServer((request, response) => {
  const requestUrl = new URL(request.url ?? "/", "http://loopback.invalid");
  const target = new URL(
    `${requestUrl.pathname}${requestUrl.search}`,
    `http://localhost:${port}`,
  );
  response.writeHead(307, {
    "Cache-Control": "no-store",
    Connection: "close",
    Location: target.toString(),
  });
  response.end();
});

await new Promise((resolve, reject) => {
  redirectServer.once("error", reject);
  redirectServer.listen(port, "127.0.0.1", () => {
    redirectServer.off("error", reject);
    resolve();
  });
});

const nextPackage = require.resolve("next/package.json");
const nextCli = path.join(path.dirname(nextPackage), "dist", "bin", "next");
const nextProcess = spawn(
  process.execPath,
  [nextCli, mode, ...nextArgs, "--hostname", "localhost"],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  },
);

console.log(`兼容入口：http://127.0.0.1:${port} → http://localhost:${port}`);

let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  redirectServer.close();
  nextProcess.kill(signal);
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

nextProcess.once("error", (error) => {
  console.error(error);
  redirectServer.close(() => {
    process.exitCode = 1;
  });
});
nextProcess.once("exit", (code, signal) => {
  redirectServer.close(() => {
    process.exitCode = code ?? (signal ? 0 : 1);
  });
});
