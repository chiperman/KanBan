import { connect } from "node:net";

const PROXY_VARIABLES = [
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "ALL_PROXY",
  "all_proxy",
];

/**
 * 当 Node 被要求使用环境代理时，只探测本机代理端点。
 * 远程代理可能受瞬态网络影响，不应在启动时擅自绕过。
 */
export async function resolveNodeNetworkEnvironment(
  environment,
  { timeoutMs = 500 } = {},
) {
  const env = { ...environment };
  if (env.NODE_USE_ENV_PROXY !== "1") {
    return { env, unavailableLocalProxies: [] };
  }

  const localProxies = PROXY_VARIABLES.flatMap((name) => {
    const value = env[name];
    if (typeof value !== "string" || value.trim() === "") return [];
    try {
      const proxy = new URL(value);
      return isLoopbackHost(proxy.hostname)
        ? [{ host: proxy.hostname, name, port: readPort(proxy) }]
        : [];
    } catch {
      return [];
    }
  });
  const unavailableLocalProxies = [];
  for (const proxy of localProxies) {
    if (!(await canConnect(proxy.host, proxy.port, timeoutMs))) {
      unavailableLocalProxies.push(`${proxy.host}:${proxy.port}`);
      // 保留空变量，防止 Next 再加载 .env.local 时恢复这条失效配置；
      // 同时让 Rust 等非 Node 运行时不再读取它。
      env[proxy.name] = "";
    }
  }

  const hasUsableEnvironmentProxy = PROXY_VARIABLES.some((name) =>
    typeof env[name] === "string" && env[name].trim() !== "",
  );
  if (!hasUsableEnvironmentProxy) {
    // 避免 Next 再次加载 .env.local 后把失效变量带入 Node 的 fetch。
    env.NODE_USE_ENV_PROXY = "0";
  }
  return {
    env,
    unavailableLocalProxies: [...new Set(unavailableLocalProxies)],
  };
}

function isLoopbackHost(host) {
  const normalized = host.toLowerCase();
  return normalized === "localhost" ||
    normalized === "::1" ||
    normalized.startsWith("127.");
}

function readPort(proxy) {
  if (proxy.port !== "") return Number(proxy.port);
  return proxy.protocol === "https:" ? 443 : 80;
}

function canConnect(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const finish = (reachable) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}
