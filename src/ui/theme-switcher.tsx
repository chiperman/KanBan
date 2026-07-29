"use client";

import { useEffect, useState } from "react";

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

function nextThemeChoice(choice: ThemeChoice): ThemeChoice {
  const currentIndex = THEME_ORDER.indexOf(choice);
  return THEME_ORDER[(currentIndex + 1) % THEME_ORDER.length];
}

function ThemeIcon({ choice }: { choice: ThemeChoice }) {
  if (choice === "light") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="3.5" />
        <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" />
      </svg>
    );
  }

  if (choice === "dark") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20 15.1A8.2 8.2 0 0 1 8.9 4a8.5 8.5 0 1 0 11.1 11.1Z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="12" rx="2" />
      <path d="M9 20h6M12 16.5V20" />
    </svg>
  );
}

export function ThemeSwitcher() {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => {
    const savedChoice = readSavedChoice();
    setChoice(savedChoice);
    applyTheme(savedChoice);
  }, []);

  function selectTheme(nextChoice: ThemeChoice) {
    try {
      window.localStorage.setItem(STORAGE_KEY, nextChoice);
    } catch {
      // The current page can still use the selected theme when storage is unavailable.
    }
    setChoice(nextChoice);
    applyTheme(nextChoice);
  }

  const nextChoice = nextThemeChoice(choice);

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`当前主题：${THEME_LABELS[choice]}；点击切换为${THEME_LABELS[nextChoice]}`}
      title={`当前：${THEME_LABELS[choice]} · 点击切换`}
      onClick={() => selectTheme(nextChoice)}
    >
      <ThemeIcon choice={choice} />
    </button>
  );
}
