import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["longbridge"],
  outputFileTracingIncludes: {
    "/*": [
      "./scripts/longbridge-quote-worker.mjs",
      "./node_modules/longbridge/**/*",
      "./node_modules/longbridge-darwin-arm64/**/*",
      "./node_modules/longbridge-darwin-x64/**/*",
      "./node_modules/longbridge-linux-arm64-gnu/**/*",
      "./node_modules/longbridge-linux-x64-gnu/**/*",
      "./node_modules/longbridge-linux-x64-musl/**/*",
    ],
  },
  async headers() {
    // 主页对所有者渲染敏感内容：禁止任何缓存存储，
    // 退出登录后回退导航不得恢复已验证视图。
    return [
      {
        source: "/",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
