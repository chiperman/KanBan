import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import "./design-tokens.css";
import "./command-menu.css";
import "./product-layout.css";
import "./vibe-components.css";

export const metadata: Metadata = {
  title: "个人资产看板",
  description: "单所有者只读个人资产看板",
};

const themeInit = `(function(){try{var k="pad-theme";var m=window.matchMedia("(prefers-color-scheme: dark)");var r=function(){try{var c=localStorage.getItem(k);return c==="light"||c==="dark"||c==="system"?c:"system";}catch(e){return "system";}};var a=function(){var c=r();document.documentElement.dataset.theme=c==="system"?(m.matches?"dark":"light"):c;document.documentElement.dataset.themeChoice=c;};a();var h=function(){if(r()==="system")a();};if(m.addEventListener){m.addEventListener("change",h);}else{m.addListener(h);}}catch(e){document.documentElement.dataset.theme="light";document.documentElement.dataset.themeChoice="system";}})();`;

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
