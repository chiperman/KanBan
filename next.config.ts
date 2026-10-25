import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // 记录本次 security 升级来源，供 Next.js 升级工具识别。
    agentUpgrade: "security",
  },
  // 浏览器验收可写入独立构建目录，避免覆盖正在运行的本地开发服务。
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // 测试路由使用独立扩展名；生产构建不发现、不打包 test-doubles。
  pageExtensions: process.env.APP_ENV === "test"
    ? ["tsx", "ts", "test-route.ts"]
    : ["tsx", "ts"],
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
