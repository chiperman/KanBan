import { lstat, readFile, readdir, readlink } from "node:fs/promises";
import path from "node:path";

export class OAuth {
  static async build(clientId, onOpenUrl) {
    const tokenDirectory = path.join(
      process.env.HOME,
      ".longbridge",
      "openapi",
      "tokens",
    );
    const tokenPath = path.join(tokenDirectory, clientId);
    const [stat, target, entries] = await Promise.all([
      lstat(tokenPath),
      readlink(tokenPath),
      readdir(tokenDirectory),
    ]);
    if (!stat.isSymbolicLink() || target !== "/dev/fd/3") {
      throw new Error("测试 SDK 检测到 Token cache 不是匿名管道");
    }
    if (entries.length !== 1 || entries[0] !== clientId) {
      throw new Error("测试 SDK 检测到额外 Token cache 文件");
    }
    const token = JSON.parse(await readFile(tokenPath, "utf8"));
    if (
      token.client_id !== clientId ||
      typeof token.access_token !== "string" ||
      token.refresh_token !== null
    ) {
      onOpenUrl(null, "unexpected-authorization");
      throw new Error("测试 SDK Token 格式无效");
    }
    return { accessToken: token.access_token };
  }
}

export class Config {
  static fromOAuth(oauth) {
    return { oauth };
  }
}

function decimal(value) {
  return { toString: () => value };
}

export class QuoteContext {
  static new(config) {
    if (!config.oauth.accessToken) throw new Error("测试 SDK 未收到内存 Token");
    return new QuoteContext();
  }

  async quote(symbols) {
    if (symbols.includes("SLOW.US")) {
      await new Promise(() => undefined);
    }
    return symbols.map((symbol) => ({
      symbol,
      lastDone: decimal("2000"),
      prevClose: decimal("1950"),
      timestamp: new Date("2026-05-29T00:00:00.000Z"),
    }));
  }
}
