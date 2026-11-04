import { useCallback, useEffect, useRef, useState } from "react";
import { ICONS } from "./Loader";

// The landing page's "how it works" demo: an item from your stock is listed on eBay and Vinted, sinks down
// both feeds over time, then gets bumped back to the top. The telemetry panel in the hero counts what the
// demo has done so far. Everything here is illustrative: no real listings or sellers.

interface DemoItem {
  title: string;
  meta: string;
  price: string;
  sku: string;
  icon: keyof typeof ICONS;
  /** Other sellers' listings around yours on each site. */
  ebay: [string, string][];
  vinted: [string, string][];
}

const ITEMS: DemoItem[] = [
  {
    title: "Margaret Atwood, The Handmaid's Tale",
    meta: "Paperback · Very good",
    price: "£6.50",
    sku: "SL-0142",
    icon: "book",
    ebay: [["The Testaments, hardback", "£8.99"], ["Alias Grace, paperback", "£4.50"]],
    vinted: [["Handmaid's Tale, Vintage PB", "£5.00"], ["Oryx and Crake", "£4.00"]],
  },
  {
    title: "Levi's 501 jeans W32 L30",
    meta: "Mid blue · Very good",
    price: "£25.00",
    sku: "SL-0143",
    icon: "shirt",
    ebay: [["Levi's 505 W32", "£22.00"], ["Wrangler Texas W32", "£18.50"]],
    vinted: [["Levi's 501 W30", "£20.00"], ["Lee Brooklyn W32", "£15.00"]],
  },
  {
    title: "Pink Floyd, The Wall (2× LP)",
    meta: "1979 UK press · Good",
    price: "£22.00",
    sku: "SL-0144",
    icon: "record",
    ebay: [["Dark Side of the Moon LP", "£28.00"], ["Wish You Were Here LP", "£19.99"]],
    vinted: [["The Wall, CD", "£4.00"], ["Animals LP", "£18.00"]],
  },
  {
    title: "Nike Air Max 90, UK 9",
    meta: "White/grey · Good",
    price: "£45.00",
    sku: "SL-0145",
    icon: "trainer",
    ebay: [["Air Max 95, UK 9", "£55.00"], ["Air Force 1, UK 9", "£40.00"]],
    vinted: [["Air Max 90, UK 8", "£38.00"], ["New Balance 574, UK 9", "£30.00"]],
  },
];

export type DemoPhase = "ready" | "listing" | "listed" | "slipped" | "bumping" | "bumped";

// Rough time a seller spends doing this by hand, per site: listing an item, or deleting and re-uploading it.
const MINUTES_TO_LIST = 6;
const MINUTES_TO_RELIST = 4;

const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Demo state shared by the hero's telemetry panel and the demo stage. */
export function useLandingDemo() {
  const [itemIndex, setItemIndex] = useState(0);
  const [phase, setPhase] = useState<DemoPhase>("ready");
  const [stats, setStats] = useState({ minutes: 0, listings: 0, bumps: 0 });
  const [log, setLog] = useState("Ready: your stock, waiting to be listed");
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());
  // Bumped each time a beam fires, so the animation restarts.
  const [beam, setBeam] = useState({ key: 0, kind: "list" as "list" | "bump" });
  const timers = useRef<number[]>([]);
  const item = ITEMS[itemIndex]!;

  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  };
  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  const list = useCallback(() => {
    clearTimers();
    setPhase("listing");
    setBeam((b) => ({ key: b.key + 1, kind: "list" }));
    setLog(`Listing ${item.sku} on eBay and Vinted…`);
    later(750, () => {
      setPhase("listed");
      setStats((s) => ({ ...s, listings: s.listings + 2, minutes: s.minutes + 2 * MINUTES_TO_LIST }));
      setLog(`Listed on both: ${item.title}`);
    });
  }, [item]);

  const slip = useCallback(() => {
    clearTimers();
    setPhase("slipped");
    setLog("Three weeks on: newer listings have pushed it down both feeds");
  }, []);

  const bump = useCallback(() => {
    clearTimers();
    setPhase("bumping");
    setBeam((b) => ({ key: b.key + 1, kind: "bump" }));
    setLog(`Relisting ${item.sku}: new listings up, old ones removed…`);
    later(650, () => {
      setPhase("bumped");
      setStats((s) => ({ ...s, bumps: s.bumps + 2, minutes: s.minutes + 2 * MINUTES_TO_RELIST }));
      setLog("Back at the top of both feeds, without re-uploading a thing");
    });
  }, [item]);

  const next = useCallback(() => {
    clearTimers();
    setItemIndex((i) => (i + 1) % ITEMS.length);
    setPhase("ready");
    setLog("Next item from your stock");
  }, []);

  // Autoplay: each finished step queues the next one.
  useEffect(() => {
    if (!playing) return;
    const step: Partial<Record<DemoPhase, [number, () => void]>> = {
      ready: [900, list],
      listed: [2600, slip],
      slipped: [1800, bump],
      bumped: [2800, next],
    };
    const s = step[phase];
    if (!s) return;
    const t = window.setTimeout(s[1], s[0]);
    return () => clearTimeout(t);
  }, [playing, phase, list, slip, bump, next]);

  return { item, itemIndex, count: ITEMS.length, phase, stats, log, playing, setPlaying, beam, list, slip, bump, next };
}

export type LandingDemo = ReturnType<typeof useLandingDemo>;

function ItemIcon({ name, size = 40 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  );
}

const fmtTime = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

const PHASE_LABEL: Record<DemoPhase, string> = {
  ready: "Step 1 · List",
  listing: "Step 1 · List",
  listed: "Step 1 · List",
  slipped: "Step 2 · Bump",
  bumping: "Step 2 · Bump",
  bumped: "Step 2 · Bump",
};

/** The hero's telemetry: what the demo below has done so far, as a seller's time saved. */
export function DemoTelemetry({ demo }: { demo: LandingDemo }) {
  const { stats, log, phase } = demo;
  return (
    <aside className="telemetry" aria-label="Demo telemetry">
      <div className="telemetry-head">
        <span className="telemetry-title">
          <span className="live-dot" aria-hidden="true" />
          Live automation telemetry
        </span>
        <span className="strike-pill">
          <s>Delete &amp; re-upload</s> <b>Done for you</b>
        </span>
      </div>
      <div className="telemetry-stats">
        <div className="tstat">
          <span className="tstat-label">Time saved</span>
          <strong className="tstat-value teal">{fmtTime(stats.minutes)}</strong>
          <span className="tstat-hint">~{MINUTES_TO_LIST} min a listing</span>
        </div>
        <div className="tstat">
          <span className="tstat-label">Listings made</span>
          <strong className="tstat-value">{stats.listings}</strong>
          <span className="tstat-hint">eBay + Vinted</span>
        </div>
        <div className="tstat">
          <span className="tstat-label">Bumps</span>
          <strong className="tstat-value coral">{stats.bumps}</strong>
          <span className="tstat-hint">back to the top</span>
        </div>
      </div>
      <div className="telemetry-log" aria-live="polite">
        <span className={`log-dot ${phase}`} aria-hidden="true" />
        <span className="log-text">{log}</span>
        <span className="log-phase">{PHASE_LABEL[phase]}</span>
      </div>
      <p className="telemetry-note">Counts what the demo below has done. Times are a typical seller's, by hand.</p>
    </aside>
  );
}

const BANNER: Record<DemoPhase, string> = {
  ready: "Your stock lives in one place. One click sends an item's photos, details and price to eBay and Vinted.",
  listing: "Your stock lives in one place. One click sends an item's photos, details and price to eBay and Vinted.",
  listed: "Listed on both sites, filled in for you. You just check it and press publish.",
  slipped: "Listings sink as newer ones arrive. Stale ones get flagged for you.",
  bumping: "One click relists it and removes the old listing. No deleting and re-uploading by hand.",
  bumped: "Back at the top of both feeds, as a fresh listing.",
};

function Feed({ site, demo }: { site: "ebay" | "vinted"; demo: LandingDemo }) {
  const { item, phase } = demo;
  const others = item[site];
  const yours = phase === "ready" || phase === "listing" ? null : phase === "slipped" ? 2 : 0;
  // Row positions: yours at the top (0) or sunk to the bottom (2); the others fill the remaining slots.
  const otherSlots = yours === 2 ? [0, 1] : [1, 2];
  const when =
    phase === "slipped" ? "Listed 3 weeks ago" : phase === "bumped" || phase === "bumping" ? "Relisted just now" : "Listed just now";
  const fresh = phase === "listed" || phase === "bumped";
  return (
    <div className={`feed feed-${site}`}>
      <div className="feed-head">
        <span className={`feed-site ${site}`}>{site === "ebay" ? "eBay" : "Vinted"}</span>
        <span className="feed-kind">{site === "ebay" ? "search results" : "newest in feed"}</span>
        <span className={`feed-rank ${yours === 2 ? "low" : ""}`}>
          {yours === null ? "Not listed yet" : yours === 0 ? "Top of the feed" : "Sinking down"}
        </span>
      </div>
      <div className="feed-rows">
        {yours === null ? (
          <div className="feed-row placeholder" style={{ transform: "translateY(0)" }}>
            Your listing appears here
          </div>
        ) : (
          <div className={`feed-row yours ${fresh ? "pop" : ""} ${yours === 2 ? "sunk" : ""}`} style={{ transform: `translateY(calc(${yours} * var(--row-step)))` }}>
            <span className="row-thumb">
              <ItemIcon name={item.icon} size={26} />
            </span>
            <span className="row-text">
              <span className={`row-badge ${yours === 2 ? "low" : ""}`}>{yours === 2 ? "Buried" : "Yours"}</span>
              <span className="row-title">{item.title}</span>
              <span className="row-when">{when}</span>
            </span>
            <span className="row-price">{item.price}</span>
          </div>
        )}
        {others.map(([title, price], i) => (
          <div key={title} className="feed-row other" style={{ transform: `translateY(calc(${otherSlots[i]} * var(--row-step)))` }}>
            <span className="row-thumb dim">#{otherSlots[i]! + 1}</span>
            <span className="row-text">
              <span className="row-title">{title}</span>
              <span className="row-when">Another seller</span>
            </span>
            <span className="row-price">{price}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The animated stage: your stock on the left, beams to eBay's and Vinted's feeds on the right. */
export function DemoStage({ demo }: { demo: LandingDemo }) {
  const { item, itemIndex, count, phase, playing, setPlaying, beam, list, bump, next } = demo;
  const busy = phase === "listing" || phase === "bumping";
  const listed = !(phase === "ready" || phase === "listing");
  const step = phase === "slipped" || phase === "bumping" || phase === "bumped" ? 2 : 1;
  return (
    <div className="demo">
      <div className="demo-dock">
        <div className="demo-controls">
          <button className={`dock-btn list ${step === 1 ? "on" : ""}`} onClick={list} disabled={busy}>
            <span className="dot" aria-hidden="true" /> 1. List on both
          </button>
          <button className={`dock-btn bump ${step === 2 ? "on" : ""}`} onClick={bump} disabled={busy || !listed}>
            <span className="dot" aria-hidden="true" /> 2. Bump to the top
          </button>
          <button className="dock-btn" onClick={next} disabled={busy}>
            Next item <span className="dock-count">{itemIndex + 1}/{count}</span>
          </button>
        </div>
        <button className={`dock-btn play ${playing ? "on" : ""}`} onClick={() => setPlaying(!playing)} aria-pressed={playing}>
          <span className="dot" aria-hidden="true" /> {playing ? "Playing" : "Paused"}
        </button>
      </div>

      <div className="demo-banner">
        <span className={`banner-pill step-${step}`}>{PHASE_LABEL[phase]}</span>
        <p>{BANNER[phase]}</p>
      </div>

      <div className="demo-stage">
        <div className={`stock-card ${phase === "listing" || phase === "bumping" ? "firing" : ""}`}>
          <div className="stock-head">
            <span className="stock-mark" aria-hidden="true">
              <img src="/favicon.svg" alt="" width={28} height={28} />
            </span>
            <span>
              <span className="stock-kicker">Your stock</span>
              <span className="stock-sub">One record, every site</span>
            </span>
            <span className="stock-sku">{item.sku}</span>
          </div>
          <div className="stock-item">
            <span className="stock-photo">
              <ItemIcon name={item.icon} size={44} />
            </span>
            <span className="stock-text">
              <span className="stock-title">{item.title}</span>
              <span className="stock-meta">{item.meta}</span>
              <span className="stock-price">{item.price}</span>
            </span>
          </div>
          <div className="stock-sites">
            <span className={`site-pill ebay ${listed ? "live" : ""}`}>eBay · {listed ? "Live" : "Ready"}</span>
            <span className={`site-pill vinted ${listed ? "live" : ""}`}>Vinted · {listed ? "Live" : "Ready"}</span>
          </div>
        </div>

        <div className="demo-hub" aria-hidden="true">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none">
            <path className="track" d="M0 50 C 50 50, 50 25, 100 25" />
            <path className="track" d="M0 50 C 50 50, 50 75, 100 75" />
            <path key={`a${beam.key}`} className={`beam ${beam.kind} ${beam.key ? "fire" : ""}`} d="M0 50 C 50 50, 50 25, 100 25" />
            <path key={`b${beam.key}`} className={`beam ${beam.kind} ${beam.key ? "fire" : ""}`} d="M0 50 C 50 50, 50 75, 100 75" />
          </svg>
          <span className={`hub-orb ${busy ? "busy" : ""}`}>
            <svg viewBox="0 0 20 20" width="22" height="22">
              <rect x="6" y="3" width="8" height="13" rx="2" fill="#b9a2ff" transform="rotate(30 10 16)" />
              <rect x="6" y="3" width="8" height="13" rx="2" fill="#ffc53d" transform="rotate(15 10 16)" />
              <rect x="6" y="3" width="8" height="13" rx="2" fill="#ff6b57" />
            </svg>
          </span>
        </div>

        <div className="demo-feeds">
          <Feed site="ebay" demo={demo} />
          <Feed site="vinted" demo={demo} />
        </div>
      </div>
    </div>
  );
}
