"use client";

import { useId } from "react";

import { TrendDotPattern } from "@/ui/trend-dot-pattern";
import { useWorkbenchDisplayPreferences } from "@/ui/workbench-display-preferences";

const PREVIEW_CURVE = "M4 78 C24 78 28 64 48 64 S76 72 92 60 S116 40 136 44 S164 60 184 42 S214 32 236 20 S280 28 316 12";
const OPTIONS = [
  {
    value: "dots",
    showDots: true,
    label: "显示点阵",
  },
  {
    value: "line",
    showDots: false,
    label: "仅显示曲线",
  },
];

export function TrendAppearanceSettings() {
  const id = useId();
  const patternId = `trend-preview-${id.replace(/[^a-zA-Z0-9]/g, "")}`;
  const { showTrendDots, setShowTrendDots } = useWorkbenchDisplayPreferences();

  return (
    <fieldset className="settings-choice-group">
      <legend>走势图点阵</legend>
      <div className="settings-choice-list">
        {OPTIONS.map((option) => (
          <label className="settings-choice" key={option.value}>
            <input
              aria-labelledby={`${id}-${option.value}-label`}
              type="radio"
              name={`${id}-trend-appearance`}
              value={option.value}
              checked={showTrendDots === option.showDots}
              onChange={() => setShowTrendDots(option.showDots)}
            />
            <span className="settings-choice-copy">
              <strong id={`${id}-${option.value}-label`}>{option.label}</strong>
            </span>
            <span aria-hidden="true" className="settings-choice-preview settings-trend-preview">
              <svg className="settings-trend-preview__chart" viewBox="0 0 320 104">
                {option.showDots ? (
                  <>
                    <defs>
                      <TrendDotPattern height={104} id={patternId} />
                    </defs>
                    <path d={`${PREVIEW_CURVE} L316 104 H4 Z`} fill={`url(#${patternId})`} />
                  </>
                ) : null}
                <path
                  d={PREVIEW_CURVE}
                  fill="none"
                  stroke="var(--display)"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.4}
                />
                <circle cx={316} cy={12} fill="var(--raised)" r={3} stroke="var(--display)" strokeWidth={2} />
              </svg>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
