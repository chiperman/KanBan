import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
