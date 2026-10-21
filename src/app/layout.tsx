import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import "./design-tokens.css";
import "./command-menu.css";
import "./product-layout.css";
import "./vibe-components.css";
import { ThemeInitializer } from "@/ui/theme-switcher";
import { AssetRefreshProvider } from "@/ui/asset-refresh-provider";
import {
  WorkbenchDisplayPreferencesProvider,
} from "@/ui/workbench-display-preferences";

export const metadata: Metadata = {
  title: "个人资产看板",
  description: "单所有者只读个人资产看板",
};

const themeBootstrap = `(function(){var choice="system";var isDemo=new URLSearchParams(window.location.search).get("mode")==="demo";if(!isDemo){try{var saved=window.localStorage.getItem("pad-theme");if(saved==="light"||saved==="dark"||saved==="system")choice=saved;}catch(error){}}var systemDark=false;try{systemDark=window.matchMedia("(prefers-color-scheme: dark)").matches;}catch(error){}document.documentElement.dataset.theme=choice==="system"?(systemDark?"dark":"light"):choice;document.documentElement.dataset.themeChoice=choice;var collapsed=false;if(!isDemo){try{collapsed=window.localStorage.getItem("pad-sidebar-collapsed")==="true";}catch(error){}}document.documentElement.dataset.sidebarCollapsed=String(collapsed);})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        {/* React warns in development when a component renders <script>;
            text/plain on the client keeps the inline bootstrap inert. */}
        <script
          dangerouslySetInnerHTML={{ __html: themeBootstrap }}
          suppressHydrationWarning
          type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
        />
        <WorkbenchDisplayPreferencesProvider>
          <AssetRefreshProvider>
            <ThemeInitializer />
            {children}
          </AssetRefreshProvider>
        </WorkbenchDisplayPreferencesProvider>
      </body>
    </html>
  );
}
