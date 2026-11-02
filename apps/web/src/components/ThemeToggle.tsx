import { THEMES, useTheme, type Theme } from "../theme";

const ICONS: Record<Theme, string> = { system: "◐", light: "☀", dark: "☾" };
const LABELS: Record<Theme, string> = { system: "System", light: "Light", dark: "Dark" };

/** Compact button for headers: cycles system → light → dark. */
export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]!;
  return (
    <button
      className="icon-button"
      onClick={() => setTheme(next)}
      title={`Theme: ${LABELS[theme]} (switch to ${LABELS[next].toLowerCase()})`}
      aria-label={`Theme: ${LABELS[theme]}. Switch to ${LABELS[next]}`}
    >
      {ICONS[theme]}
    </button>
  );
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
