"use client";

import { useId } from "react";

import { useWorkbenchDisplayPreferences } from "@/ui/workbench-display-preferences";

export function TrendAppearanceSettings() {
  const id = useId();
  const { showTrendDots, setShowTrendDots } = useWorkbenchDisplayPreferences();

  return (
    <div className="settings-choice-list">
      <label className="vibe-choice">
        <input
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-description`}
          type="checkbox"
          checked={showTrendDots}
          onChange={(event) => setShowTrendDots(event.target.checked)}
        />
        <span className="settings-choice-copy">
          <strong id={`${id}-label`}>走势图点阵</strong>
          <span id={`${id}-description`}>在曲线下方显示点阵填充</span>
        </span>
      </label>
    </div>
  );
}
