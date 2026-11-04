import { useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";

const KEY = "jf.theme";
const listeners = new Set<(t: Theme) => void>();

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

/** "system" follows the OS; the CSS reads `data-theme` on <html> (see index.html for the pre-paint copy). */
export function setTheme(theme: Theme) {
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // storage unavailable (private mode etc.): still apply for this page view
  }
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  for (const fn of listeners) fn(theme);
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, set] = useState(getTheme);
  useEffect(() => {
    listeners.add(set);
    return () => void listeners.delete(set);
  }, []);
  return [theme, setTheme];
}
