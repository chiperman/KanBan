import type { Metadata } from "next";
import { cookies } from "next/headers";
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

export default async function RootLayout({ children }: { children: ReactNode }) {
  const storedSensitiveInfoPreference =
    (await cookies()).get("pad-sensitive-info")?.value;
  const initialSensitiveInfoPreference =
    storedSensitiveInfoPreference === "shown" ||
    storedSensitiveInfoPreference === "hidden"
      ? storedSensitiveInfoPreference
      : null;

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <WorkbenchDisplayPreferencesProvider
          initialSensitiveInfoPreference={initialSensitiveInfoPreference}
        >
          <AssetRefreshProvider>
            <ThemeInitializer />
            {children}
          </AssetRefreshProvider>
        </WorkbenchDisplayPreferencesProvider>
      </body>
    </html>
  );
}
