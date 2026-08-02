import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import "./design-tokens.css";
import "./command-menu.css";
import "./product-layout.css";
import "./vibe-components.css";
import { ThemeInitializer } from "@/ui/theme-switcher";

export const metadata: Metadata = {
  title: "个人资产看板",
  description: "单所有者只读个人资产看板",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <ThemeInitializer />
        {children}
      </body>
    </html>
  );
}
