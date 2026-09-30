"use client";

import { useEffect, useLayoutEffect, useState } from "react";

import {
  VibeIcon,
  type VibeIconName,
} from "@/ui/vibe/vibe-icon";
import { VibeTooltip } from "@/ui/vibe/vibe-tooltip";

type ThemeChoice = "light" | "dark" | "system";

const STORAGE_KEY = "pad-theme";
const THEME_ORDER: ThemeChoice[] = ["system", "light", "dark"];
const THEME_LABELS: Record<ThemeChoice, string> = {
  light: "浅色",
  dark: "深色",
  system: "跟随系统",
};

function resolveTheme(choice: ThemeChoice): "light" | "dark" {
  if (choice !== "system") return choice;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(choice: ThemeChoice): void {
  document.documentElement.dataset.theme = resolveTheme(choice);
  document.documentElement.dataset.themeChoice = choice;
}

function readSavedChoice(): ThemeChoice {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === "light" || saved === "dark" || saved === "system"
      ? saved
      : "system";
  } catch {
    return "system";
  }
}

function isDemoModeLocation(): boolean {
  return new URLSearchParams(window.location.search).get("mode") === "demo";
}

export function ThemeInitializer() {
  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const initialChoice = () =>
      isDemoModeLocation() ? "system" : readSavedChoice();
    const applySavedTheme = () => applyTheme(initialChoice());
    const updateSystemTheme = () => {
      if (initialChoice() === "system") applySavedTheme();
    };

    applySavedTheme();
    media.addEventListener("change", updateSystemTheme);
    return () => media.removeEventListener("change", updateSystemTheme);
  }, []);

  return null;
}

function nextThemeChoice(choice: ThemeChoice): ThemeChoice {
  const currentIndex = THEME_ORDER.indexOf(choice);
  return THEME_ORDER[(currentIndex + 1) % THEME_ORDER.length];
}

const THEME_ICONS: Record<Exclude<ThemeChoice, "system">, VibeIconName> = {
  light: "sun",
  dark: "moon",
};

function ThemeIcon({ choice }: { choice: ThemeChoice }) {
  if (choice === "system") {
    return <VibeIcon name="computer" />;
  }
  return <VibeIcon name={THEME_ICONS[choice]} />;
}

export function ThemeSwitcher({
  persist = true,
  showLabel = false,
  tooltipSide = "bottom",
}: {
  persist?: boolean;
  showLabel?: boolean;
  tooltipSide?: "bottom" | "right";
}) {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => {
    const savedChoice = persist ? readSavedChoice() : "system";
    setChoice(savedChoice);
    applyTheme(savedChoice);
  }, [persist]);

  function selectTheme(nextChoice: ThemeChoice) {
    if (persist) {
      try {
        window.localStorage.setItem(STORAGE_KEY, nextChoice);
      } catch {
        // The current page can still use the selected theme when storage is unavailable.
      }
    }
    setChoice(nextChoice);
    applyTheme(nextChoice);
  }

  const nextChoice = nextThemeChoice(choice);

  const tooltipLabel = `当前：${THEME_LABELS[choice]}；点击切换为${THEME_LABELS[nextChoice]}`;

  return (
    <VibeTooltip align="end" label={tooltipLabel} side={tooltipSide}>
      <button
        type="button"
        className={showLabel ? "theme-toggle theme-toggle--labeled" : "theme-toggle"}
        aria-label={`当前主题：${THEME_LABELS[choice]}；点击切换为${THEME_LABELS[nextChoice]}`}
        onClick={() => selectTheme(nextChoice)}
      >
        <ThemeIcon choice={choice} />
        {showLabel ? <span className="workbench-control-label">主题</span> : null}
      </button>
    </VibeTooltip>
  );
}
