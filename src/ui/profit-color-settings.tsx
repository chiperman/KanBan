"use client";

import { useEffect, useState } from "react";

import {
  DEFAULT_PROFIT_COLOR_SCHEME,
  isProfitColorScheme,
  PROFIT_COLOR_SCHEME_COOKIE_KEY,
  PROFIT_COLOR_SCHEME_STORAGE_KEY,
  type ProfitColorScheme,
} from "@/ui/profit-color-scheme";

const OPTIONS: Array<{
  description: string;
  label: string;
  value: ProfitColorScheme;
}> = [
  {
    value: "red-up",
    label: "红涨绿跌",
    description: "盈利显示红色，亏损显示绿色。",
  },
  {
    value: "green-up",
    label: "绿涨红跌",
    description: "盈利显示绿色，亏损显示红色。",
  },
];

function persistScheme(value: ProfitColorScheme) {
  try {
    window.localStorage.setItem(PROFIT_COLOR_SCHEME_STORAGE_KEY, value);
  } catch {
    // The current page can still use the selected scheme.
  }
  document.cookie = `${PROFIT_COLOR_SCHEME_COOKIE_KEY}=${value}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function ProfitColorSettings({
  initialScheme,
}: {
  initialScheme: ProfitColorScheme | null;
}) {
  const [scheme, setScheme] = useState<ProfitColorScheme>(
    initialScheme ?? DEFAULT_PROFIT_COLOR_SCHEME,
  );
  const [ready, setReady] = useState(initialScheme !== null);

  useEffect(() => {
    if (initialScheme !== null) {
      persistScheme(initialScheme);
      return;
    }

    let restoredScheme = DEFAULT_PROFIT_COLOR_SCHEME;
    try {
      const saved = window.localStorage.getItem(
        PROFIT_COLOR_SCHEME_STORAGE_KEY,
      );
      if (isProfitColorScheme(saved)) restoredScheme = saved;
    } catch {
      // The settings page can still use the default when storage is unavailable.
    }
    setScheme(restoredScheme);
    persistScheme(restoredScheme);
    setReady(true);
  }, [initialScheme]);

  function selectScheme(value: ProfitColorScheme) {
    setScheme(value);
    persistScheme(value);
  }

  return (
    <fieldset
      className="settings-choice-group"
      aria-describedby="profit-color-description"
      data-ready={ready ? "true" : "false"}
    >
      <legend>盈亏颜色</legend>
      <p className="settings-description" id="profit-color-description">
        应用于资产变化、浮动盈亏与持仓盈亏率。零值始终使用中性色。
      </p>
      <div className="settings-choice-list">
        {OPTIONS.map((option) => (
          <label className="settings-choice" key={option.value}>
            <input
              type="radio"
              name="profit-color-scheme"
              value={option.value}
              checked={scheme === option.value}
              onChange={() => selectScheme(option.value)}
            />
            <span className="settings-choice-copy">
              <strong>{option.label}</strong>
              <span>{option.description}</span>
            </span>
            <span
              className="settings-choice-preview"
              aria-hidden="true"
              data-profit-color-scheme={option.value}
            >
              <span
                className="profit-color-value"
                data-profit-color-scheme={option.value}
                data-profit-direction="positive"
              >
                +12.34%
              </span>
              <span
                className="profit-color-value"
                data-profit-color-scheme={option.value}
                data-profit-direction="negative"
              >
                −5.67%
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
