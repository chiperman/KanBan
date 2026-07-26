import { rmSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function validateInput(value) {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof value.clientId !== "string" ||
    !/^[A-Za-z0-9._-]+$/.test(value.clientId) ||
    !Array.isArray(value.symbols) ||
    value.symbols.some(
      (symbol) => typeof symbol !== "string" || !/^[A-Za-z0-9.-]+$/.test(symbol),
    )
  ) {
    throw new Error("长桥 SDK 行情请求格式无效");
  }
  return value;
}

const input = validateInput(JSON.parse(await readStdin()));
const temporaryHome = await mkdtemp(path.join(os.tmpdir(), "longbridge-sdk-"));
process.once("SIGTERM", () => {
  rmSync(temporaryHome, { recursive: true, force: true });
  process.exit(143);
});

try {
  const tokenDirectory = path.join(
    temporaryHome,
    ".longbridge",
    "openapi",
    "tokens",
  );
  await mkdir(tokenDirectory, { recursive: true, mode: 0o700 });
  await symlink("/dev/fd/3", path.join(tokenDirectory, input.clientId));
  process.env.HOME = temporaryHome;
  process.env.LONGBRIDGE_PRINT_QUOTE_PACKAGES = "false";
  process.chdir(temporaryHome);

  const sdkModule = process.env.APP_ENV === "test"
    ? process.env.LONGBRIDGE_SDK_TEST_MODULE ?? "longbridge"
    : "longbridge";
  const { Config, OAuth, QuoteContext } = await import(sdkModule);
  const oauth = await OAuth.build(input.clientId, () => {
    throw new Error("长桥 SDK 未从匿名管道读取到内存 Token");
  });
  const context = QuoteContext.new(
    Config.fromOAuth(oauth, { enablePrintQuotePackages: false }),
  );
  const quotes = [];
  for (let start = 0; start < input.symbols.length; start += 500) {
    quotes.push(...await context.quote(input.symbols.slice(start, start + 500)));
  }
  process.stdout.write(JSON.stringify(quotes.map((quote) => ({
    symbol: quote.symbol,
    lastDone: quote.lastDone.toString(),
    prevClose: quote.prevClose.toString(),
    timestamp: quote.timestamp.toISOString(),
  }))));
} finally {
  await rm(temporaryHome, { recursive: true, force: true });
}
