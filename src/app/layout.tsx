import type { Metadata } from "next";
import { Doto, Space_Grotesk, Space_Mono } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";
import "./design-tokens.css";
import "./command-menu.css";
import "./nothing-system.css";

const doto = Doto({
  axes: ["ROND"],
  display: "swap",
  subsets: ["latin"],
  variable: "--font-doto",
  weight: "variable",
});

const spaceGrotesk = Space_Grotesk({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  weight: ["300", "400", "500"],
});

const spaceMono = Space_Mono({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-space-mono",
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "个人资产看板",
  description: "单所有者只读个人资产看板",
};

const themeInit = `(function(){try{var m=window.matchMedia("(prefers-color-scheme: dark)");var a=function(e){document.documentElement.dataset.theme=e.matches?"dark":"light";document.documentElement.dataset.themeChoice="system";};a(m);if(m.addEventListener){m.addEventListener("change",a);}else{m.addListener(a);}}catch(e){document.documentElement.dataset.theme="light";document.documentElement.dataset.themeChoice="system";}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="zh-CN"
      className={`${doto.variable} ${spaceGrotesk.variable} ${spaceMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        {children}
      </body>
    </html>
  );
}
