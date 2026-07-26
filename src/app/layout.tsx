import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import "./design-tokens.css";
import "./command-menu.css";
import "./nothing-system.css";

export const metadata: Metadata = {
  title: "个人终端 · 公开主页",
  description: "单所有者个人终端的公开主页",
};

const themeInit = `(function(){try{var c=localStorage.getItem("pad-theme")||"system";var d=window.matchMedia("(prefers-color-scheme: dark)").matches;var t=c==="system"?(d?"dark":"light"):c;document.documentElement.dataset.theme=t;document.documentElement.dataset.themeChoice=c;}catch(e){document.documentElement.dataset.theme="light";}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        {children}
      </body>
    </html>
  );
}
