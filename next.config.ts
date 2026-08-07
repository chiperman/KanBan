import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 允许通过当前设备的 Tailscale HTTPS 入口使用开发服务器。
  allowedDevOrigins: ["xiaoxmacbook-pro.tail72342.ts.net"],
  async headers() {
    // 主页对所有者渲染敏感内容：禁止任何缓存存储，
    // 退出登录后回退导航不得恢复已验证视图。
    return [
      {
        source: "/",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        source: "/asset-sources/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        source: "/data-health",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        source: "/settings",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
