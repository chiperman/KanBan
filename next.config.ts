import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 浏览器验收可写入独立构建目录，避免覆盖正在运行的本地开发服务。
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
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
