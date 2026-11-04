import type { ReactNode } from "react";

// Line icons of the kind of things sellers list, drawn in the accent colour (stroke = currentColor).
const ICONS: Record<string, ReactNode> = {
  shirt: <path d="M8.5 3.5 4 5.5 2 10l3 1.3V20h14v-8.7l3-1.3-2-4.5-4.5-2C15 5.2 13.7 6.3 12 6.3S9 5.2 8.5 3.5Z" />,
  book: (
    <>
      <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5v-15Z" />
      <path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3" />
      <path d="M9 7.5h6M9 10.5h4" />
    </>
  ),
  tv: (
    <>
      <rect x="2.5" y="6.5" width="19" height="12" rx="2" />
      <path d="m8.5 2.5 3.5 4 3.5-4M8 21.5h8" />
    </>
  ),
  trainer: (
    <>
      <path d="M2.5 16V9.5l4 1.3L9 8l3 3.3 4.6 1.5 3.8.9a1.6 1.6 0 0 1 1.1 1.5V16Z" />
      <path d="M2.5 16h19v2.5h-19zM10 11l1.2-.9M12.5 12.5l1.2-.9" />
    </>
  ),
  bag: (
    <>
      <path d="M5 8.5h14l-1.2 12H6.2L5 8.5Z" />
      <path d="M9 8.5V6.5a3 3 0 0 1 6 0v2" />
    </>
  ),
  record: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 12h.01M7 9.5a5.5 5.5 0 0 1 2.5-2.5" />
    </>
  ),
};

/**
 * The loading screen: clothes, books, a TV and more riding a conveyor belt left to right, with what's
 * loading spelled out underneath. Still icons for people who prefer reduced motion.
 */
export function Loader({ label = "Loading…", full = false }: { label?: string; full?: boolean }) {
  return (
    <div className={`loader ${full ? "loader-full" : ""}`} role="status" aria-live="polite">
      <div className="loader-track" aria-hidden="true">
        {Object.entries(ICONS).map(([name, icon], i) => (
          <span key={name} className="loader-item" style={{ animationDelay: `${-i * 1.2}s` }}>
            <svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              {icon}
            </svg>
          </span>
        ))}
        <div className="loader-belt" />
      </div>
      <p className="loader-label">{label}</p>
    </div>
  );
}
