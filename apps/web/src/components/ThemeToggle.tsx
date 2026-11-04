import { useEffect, useState } from "react";
import { THEMES, useTheme, type Theme } from "../theme";

const ICONS: Record<Theme, string> = { system: "◐", light: "☀", dark: "☾" };
const LABELS: Record<Theme, string> = { system: "System", light: "Light", dark: "Dark" };

/**
 * Compact button for headers: switches between light and dark, showing the one in use. (Following the
 * system setting is on the settings page; here it would look the same as one of the two.)
 */
export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const shown = useEffectiveTheme(theme);
  const next = shown === "dark" ? "light" : "dark";
  return (
    <button
      className="icon-button"
      onClick={() => setTheme(next)}
      title={`Switch to ${LABELS[next].toLowerCase()} mode`}
      aria-label={`Switch to ${LABELS[next].toLowerCase()} mode`}
    >
      {ICONS[shown]}
    </button>
  );
}

/** Light or dark, as actually shown: "system" resolves to the OS setting, and follows it when it changes. */
function useEffectiveTheme(theme: Theme): "light" | "dark" {
  const query = "(prefers-color-scheme: dark)";
  const [osDark, setOsDark] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setOsDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return theme === "system" ? (osDark ? "dark" : "light") : theme;
}

/** Segmented control for the settings page. */
export function ThemePicker() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="segmented" role="radiogroup" aria-label="Theme">
      {THEMES.map((t) => (
        <button key={t} role="radio" aria-checked={theme === t} className={theme === t ? "active" : ""} onClick={() => setTheme(t)}>
          <span aria-hidden="true">{ICONS[t]}</span> {LABELS[t]}
        </button>
      ))}
    </div>
  );
}
