import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { FanIcon } from "../components/Brand";
import { ICONS } from "../components/Loader";
import { SiteHeader } from "../components/SiteHeader";

const ESSAY = "https://paulgraham.com/stuff.html";

/** Extra line icons for the pile (the loader's set covers the rest). */
const EXTRA_ICONS = {
  camera: (
    <>
      <path d="M3 9a2 2 0 0 1 2-2h.9a2 2 0 0 0 1.7-.9l.8-1.2A2 2 0 0 1 10.1 4h3.8a2 2 0 0 1 1.7.9l.8 1.2a2 2 0 0 0 1.7.9H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  walkman: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="14" cy="12" r="2" />
    </>
  ),
  pedal: (
    <>
      <rect x="6" y="3" width="12" height="18" rx="2" />
      <circle cx="10" cy="8" r="1.5" />
      <circle cx="14" cy="8" r="1.5" />
      <rect x="9" y="14" width="6" height="4" rx="1" />
    </>
  ),
};
type IconName = keyof typeof ICONS | keyof typeof EXTRA_ICONS;

/** Tayfun's pile of stuff, for the playground. */
const PILE: { name: string; short: string; price: string; views: string; favs: string; icon: IconName; tone: string }[] = [
  { name: "Vintage 90s Nike Windbreaker", short: "90s Jacket", price: "£45", views: "+64 views", favs: "❤️ 29 favs", icon: "shirt", tone: "teal" },
  { name: "Olympus OM-10 35mm Film Camera", short: "35mm Cam", price: "£85", views: "+112 views", favs: "❤️ 44 favs", icon: "camera", tone: "amber" },
  { name: "Retro Air Jordan 4 Sneakers", short: "Retro Kicks", price: "£140", views: "+189 views", favs: "❤️ 73 favs", icon: "trainer", tone: "coral" },
  { name: "Sony Cassette Walkman Player", short: "Walkman", price: "£65", views: "+91 views", favs: "❤️ 38 favs", icon: "walkman", tone: "teal" },
  { name: "Analog Guitar Fuzz Pedal", short: "Fuzz Pedal", price: "£70", views: "+53 views", favs: "❤️ 19 favs", icon: "pedal", tone: "violet" },
  { name: "Box of Vintage Sci-Fi Hardcovers", short: "Sci-Fi Books", price: "£32", views: "+47 views", favs: "❤️ 22 favs", icon: "book", tone: "amber" },
];

type Mode = "hand" | "app";

function Icon({ name, size = 30 }: { name: IconName; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {name in EXTRA_ICONS ? EXTRA_ICONS[name as keyof typeof EXTRA_ICONS] : ICONS[name as keyof typeof ICONS]}
    </svg>
  );
}

/**
 * A friendly cartoon of Tayfun: a geek with a crew cut and round glasses. Smiles with Stock & List; frowns,
 * worries and sweats doing it by hand.
 */
function Avatar({ mode }: { mode: Mode }) {
  const happy = mode === "app";
  const ink = "#14181a";
  return (
    <svg className="about-avatar" viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
      <rect width="64" height="64" rx="18" className="avatar-tile" />
      {/* ears, behind the head */}
      <circle cx="17.5" cy="37" r="3.6" fill="#f5cfa0" stroke={ink} strokeWidth="1.8" />
      <circle cx="46.5" cy="37" r="3.6" fill="#f5cfa0" stroke={ink} strokeWidth="1.8" />
      {/* head */}
      <ellipse cx="32" cy="37" rx="14" ry="15.5" fill="#fde2b8" stroke={ink} strokeWidth="2" />
      {/* crew cut: short, flat on top, with a few bristles */}
      <path d="M18.6 28.6C18.2 20 24 16.5 32 16.5s13.8 3.5 13.4 12.1c-2.4-3.8-6.6-5.6-13.4-5.6s-11 1.8-13.4 5.6Z" fill="#2b2f33" stroke={ink} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M23 18.2v-1.6M27 17v-1.7M31 16.6v-1.8M35 16.7v-1.8M39 17.2v-1.7M43 18.6v-1.5" stroke={ink} strokeWidth="1.2" strokeLinecap="round" />
      {/* eyebrows: relaxed, or raised and worried */}
      {happy ? (
        <path d="M21.8 29.2q3.4-1.5 6.8 0M35.4 29.2q3.4-1.5 6.8 0" fill="none" stroke={ink} strokeWidth="1.8" strokeLinecap="round" />
      ) : (
        <path d="M21.8 29.4l6.8-1.9M35.4 27.5l6.8 1.9" fill="none" stroke={ink} strokeWidth="1.8" strokeLinecap="round" />
      )}
      {/* round glasses */}
      <path d="M20.6 35.5l-3-1M43.4 35.5l3-1" stroke={ink} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="26" cy="35.5" r="5.1" fill="rgba(255,255,255,0.35)" stroke={ink} strokeWidth="2" />
      <circle cx="38" cy="35.5" r="5.1" fill="rgba(255,255,255,0.35)" stroke={ink} strokeWidth="2" />
      <path d="M31.3 34.6q0.7-1.2 1.4 0" fill="none" stroke={ink} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M23.2 32.4l1.6-1.4M35.2 32.4l1.6-1.4" stroke="#fff" strokeWidth="1.1" strokeLinecap="round" opacity="0.8" />
      {/* eyes */}
      <circle cx="26" cy={happy ? 35.4 : 35.8} r="1.5" fill={ink} />
      <circle cx="38" cy={happy ? 35.4 : 35.8} r="1.5" fill={ink} />
      {/* nose */}
      <path d="M32 38.5q-1.8 3.2 0.4 3.6" fill="none" stroke={ink} strokeWidth="1.5" strokeLinecap="round" />
      {/* cheeks and mouth */}
      {happy && <circle cx="22.5" cy="42.5" r="2.2" fill="#ff8a78" opacity="0.45" />}
      {happy && <circle cx="41.5" cy="42.5" r="2.2" fill="#ff8a78" opacity="0.45" />}
      <path
        d={happy ? "M27 45.2q5 4.2 10 0" : "M27.2 47.4q1.3-1.6 2.5 0t2.5 0t2.5 0t2.5 0"}
        fill="none"
        stroke={ink}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* sweat drop when doing it by hand */}
      {!happy && <path d="M48.5 22s3.6 4.4 3.6 6.3a3.6 3.6 0 0 1-7.2 0c0-1.9 3.6-6.3 3.6-6.3z" fill="#5ec8f0" stroke={ink} strokeWidth="1.3" />}
    </svg>
  );
}

const CONFETTI = ["#ff6b57", "#34d3b8", "#ffc53d", "#00a8b8", "#b9a2ff"];

/** "Sell by hand" vs "Stock & List": pick something from the pile and see where it ends up on eBay and Vinted. */
function Playground({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  const [index, setIndex] = useState(0);
  const [wasted, setWasted] = useState(45);
  const [pop, setPop] = useState(0);
  const [burst, setBurst] = useState(0);
  const item = PILE[index]!;
  const reduced = useRef(typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

  function launch(i: number) {
    setIndex(i);
    setPop((p) => p + 1);
    if (mode === "hand") setWasted((w) => w + 18);
    else if (!reduced.current) setBurst((b) => b + 1);
  }
  function action() {
    if (mode === "hand") setWasted((w) => w + 22);
    else launch((index + 1) % PILE.length);
  }
  function switchMode(m: Mode) {
    setMode(m);
    setPop((p) => p + 1);
    if (m === "app" && !reduced.current) setBurst((b) => b + 1);
  }

  // Wander through the pile on its own in Stock & List mode, unless the visitor prefers less motion.
  useEffect(() => {
    if (reduced.current || mode !== "app") return;
    const t = window.setInterval(() => launch((index + 1) % PILE.length), 4800);
    return () => clearInterval(t);
  });

  const hand = mode === "hand";
  const wastedLabel = `Sunday Wasted: ${3 + Math.floor(wasted / 60)} hrs ${wasted % 60} mins`;
  const feeds = {
    ebay: hand
      ? { badge: "⚓ Sunk to page 12", sub: "48 hrs old • 0 views", status: "Buried in feed", tag: "😩 Needs manual relist", stat: "💤 0 new views",
          floor: ["⚓ Listing sunk after 2 days", "Must delete & re-upload by hand"] }
      : { badge: "🚀 Bumped to #1", sub: "Relisted automatically", status: "#1 top spot", tag: "⚡ 2-click listed", stat: `🔥 ${item.views}`,
          floor: ["🚀 Auto-bump trampoline armed", "No manual delete needed!"] },
    vinted: hand
      ? { badge: "⚓ Sunk to page 19", sub: "48 hrs old • Forgotten", status: "Buried in feed", tag: "😩 Copy-paste again", stat: "💤 Stale listing",
          floor: ["⚓ Buried under new uploads", "20 mins wasted re-typing"] }
      : { badge: "🚀 Bumped to #1", sub: "Zero manual work", status: "#1 top spot", tag: "⚡ Synced simultaneously", stat: item.favs,
          floor: ["⚡ Auto-relist booster active", "Bounces right back to #1!"] },
  };

  return (
    <div className={`playground mode-${mode}`}>
      <div className="mode-bar">
        <div className="mode-switch" role="radiogroup" aria-label="How to sell it">
          <button role="radio" aria-checked={hand} className={hand ? "on hand" : ""} onClick={() => switchMode("hand")}>
            <span aria-hidden="true">🥵</span> 1. Sell by hand (the trap)
          </button>
          <button role="radio" aria-checked={!hand} className={!hand ? "on app" : ""} onClick={() => switchMode("app")}>
            <span aria-hidden="true">⚡</span> 2. Use Stock &amp; List (magic)
          </button>
        </div>
        <button className="action-btn" onClick={action}>
          <span aria-hidden="true">{hand ? "🗑️" : "🚀"}</span> {hand ? "Delete & re-upload by hand" : "Bump & launch item!"}
        </button>
      </div>

      <div className="stage-card">
        <div className="confetti" aria-hidden="true">
          {burst > 0 &&
            Array.from({ length: 18 }, (_, i) => (
              <span
                key={`${burst}-${i}`}
                className="confetti-bit"
                style={{
                  left: `${62 + ((i * 37) % 25) - 12}%`,
                  top: `${45 + ((i * 53) % 20) - 10}%`,
                  background: CONFETTI[i % CONFETTI.length],
                  ["--tx" as string]: `${(((i * 71) % 100) / 100 - 0.5) * 160}px`,
                  ["--ty" as string]: `${(((i * 43) % 100) / 100 - 0.7) * 140}px`,
                  ["--rot" as string]: `${(i * 97) % 360}deg`,
                }}
              />
            ))}
        </div>

        <div className="stage-top">
          <span className={`stage-badge ${mode}`}>{hand ? "🚨 By hand mode (the trap)" : "✨ Stock & List mode"}</span>
          <span className="stage-line">
            {hand ? "Copy-pasting twice, sinking to page 12, deleting & re-uploading by hand…" : "1 vault → 2-click eBay & Vinted → auto-bumps to #1!"}
          </span>
          <span className="stage-meter">
            <span aria-hidden="true">{hand ? "🥵" : "☕"}</span> {hand ? wastedLabel : "Time spent: 2 clicks (8 secs)"}
          </span>
        </div>

        <div className="stage-body">
          <div className="pile-col">
            <div className="pile-head">
              <span className="hand-note">Click any item to test it! 👇</span>
              <h4>Tayfun’s mountain of “stuff”</h4>
            </div>
            <div className="pile">
              {hand && (
                <div className="chaos" aria-hidden="true">
                  <span className="chaos-tag t1">⚠️ Ctrl+C / Ctrl+V ×24</span>
                  <span className="chaos-tag t2">🗑️ Deleting old listing…</span>
                  <span className="chaos-tag t3">⏳ Re-uploading 8 photos by hand…</span>
                </div>
              )}
              {PILE.map((p, i) => (
                <button
                  key={p.short}
                  className={`pile-item ${p.tone} ${i === index ? "picked" : ""}`}
                  style={{ ["--tilt" as string]: `${(i % 2 ? 1 : -1) * (4 + (i % 3) * 1.5)}deg`, animationDelay: `${i * 0.35}s` }}
                  onClick={() => launch(i)}
                  title={`Launch: ${p.name}`}
                >
                  <Icon name={p.icon} />
                  <span>{p.short}</span>
                </button>
              ))}
            </div>
            <div className={`hub-pill ${mode}`}>
              <span aria-hidden="true">{hand ? <span className="spin">🐹</span> : "🔐"}</span>
              <span>
                <strong>{hand ? "Manual hamster wheel" : "Stock & List vault"}</strong>
                <small>{hand ? "Delete → re-upload → repeat" : "Keep inventory in 1 place"}</small>
              </span>
            </div>
          </div>

          <div className="mini-feeds">
            {(["ebay", "vinted"] as const).map((site) => {
              const f = feeds[site];
              return (
                <div key={site} className="mini-feed">
                  <div className="mini-head">
                    <span className={`feed-site ${site}`}>{site === "ebay" ? "eBay" : "Vinted"}</span>
                    <span className={`mini-status ${hand ? "low" : ""}`}>{f.status}</span>
                    <span className="mini-tag">{f.tag}</span>
                  </div>
                  <div className="mini-rows">
                    <div key={`${site}-${pop}`} className={`mini-row ${hand ? "sunk" : "top"} ${reduced.current ? "" : "drop-in"}`}>
                      <span className={`row-thumb ${item.tone}`}>
                        <Icon name={item.icon} size={22} />
                      </span>
                      <span className="row-text">
                        <span className="row-meta">
                          <span className={`row-badge ${hand ? "low" : ""}`}>{f.badge}</span>
                          <span className="row-when">{f.sub}</span>
                        </span>
                        <span className="row-title">{item.name}</span>
                      </span>
                      <span className="row-end">
                        <span className="row-price">{item.price}</span>
                        <span className="row-stat">{f.stat}</span>
                      </span>
                    </div>
                    <div className="mini-floor">
                      <span>{f.floor[0]}</span>
                      <span>{f.floor[1]}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="stage-foot">
          <span>
            🎯 Currently testing from Tayfun’s room: <strong>{item.name}</strong>
          </span>
          <button className="next-btn" onClick={() => launch((index + 1) % PILE.length)}>
            Next item in pile →
          </button>
        </div>
      </div>
    </div>
  );
}

/** Why Stock & List exists, told by Tayfun, with a "by hand vs Stock & List" playground. */
export function About() {
  const [mode, setMode] = useState<Mode>("app");
  return (
    <div className="landing-page about-page">
      <div className="landing">
        <SiteHeader />

        <div className="about-stickers">
          <span className="sticker amber">📦 The origin story • Why Stock &amp; List exists</span>
          <span className="sticker plain">
            <span className="live-dot" aria-hidden="true" />
            <span className="hand-font">Click any item in Tayfun’s pile below! 👇</span>
          </span>
        </div>

        <div className="about-grid">
          <article className="story-card">
            <span className="corner-tape">True story!</span>
            <div className="founder">
              <Avatar mode={mode} />
              <div>
                <span className="kicker">Meet the founder</span>
                <h1>Hi, I’m Tayfun.</h1>
                <span className={`mood ${mode}`}>
                  {mode === "app" ? "Current mood: relieved & clutter-free ✨" : "Current mood: drowning in tabs & relisting 😩"}
                </span>
              </div>
            </div>

            <h2 className="story-head">
              I had way too much{" "}
              <span className="pg-wrap">
                <a className="stuff-link" href={ESSAY} target="_blank" rel="noreferrer">
                  “stuff” ↗
                </a>
                <span className="pg-card" role="tooltip">
                  <span className="pg-meta">
                    <span>📖 paulgraham.com/stuff.html</span>
                    <span>2007 essay</span>
                  </span>
                  <q>I have too much stuff. Most people in America do… The trouble with stuff is that it starts to own you.</q>
                  <span className="pg-cta">Click to read Paul Graham’s classic essay →</span>
                </span>
              </span>{" "}
              and zero clue how to start getting rid of it.
            </h2>

            <p>
              A few months ago, I looked around my room and had that exact realisation Paul Graham wrote about in his famous
              essay on{" "}
              <a href={ESSAY} target="_blank" rel="noreferrer">
                “Stuff”
              </a>
              : my closet was packed with jackets I never wore, retro gadgets and spare sneakers. They weren’t serving me any
              more. They were just taking up mental rent.
            </p>
            <p>
              So I decided to sell them online. <strong>Big mistake.</strong> Turning a pile of stuff into cash turned into a
              second, unpaid job:
            </p>
            <ul className="pains">
              <li>
                <span aria-hidden="true">😩</span>
                <span>
                  <strong>The duplicate work trap:</strong> uploading the exact same 8 photos, title, measurements and price on{" "}
                  <strong>eBay</strong>… and then doing it all over again on <strong>Vinted</strong>.
                </span>
              </li>
              <li>
                <span aria-hidden="true">⚓</span>
                <span>
                  <strong>The page-12 graveyard:</strong> if an item doesn’t sell in 48 hours, it sinks to the bottom of the feed
                  where nobody ever scrolls.
                </span>
              </li>
              <li>
                <span aria-hidden="true">🐹</span>
                <span>
                  <strong>The delete &amp; re-upload hamster wheel:</strong> the only way to get eyes back on your item was
                  deleting the listing and re-uploading everything by hand.
                </span>
              </li>
            </ul>
            <p>
              I realised I was spending my whole Sunday fighting upload forms instead of actually clearing my room or finding cool
              stock. <mark>So I built Stock &amp; List to do the boring part for me.</mark>
            </p>

            <div className="signoff">
              <div>
                <div className="signature">Tayfun</div>
                <div className="muted small">Founder &amp; recovering “stuff” collector</div>
              </div>
              <a className="button outline tactile-btn" href={ESSAY} target="_blank" rel="noreferrer">
                📜 Read PG’s “Stuff” essay →
              </a>
            </div>
          </article>

          <Playground mode={mode} setMode={setMode} />
        </div>

        <div className="chapters">
          <div className="chapter">
            <div className="chapter-top">
              <span className="chapter-tag amber">Chapter 01</span>
              <span aria-hidden="true">📚</span>
            </div>
            <h3>The Paul Graham “Stuff” epiphany</h3>
            <p className="muted">
              Like Paul Graham wrote in <a href={ESSAY} target="_blank" rel="noreferrer">his famous essay</a>, unused possessions
              quietly drain your energy. Tayfun wanted a clean room, not a part-time data-entry job.
            </p>
            <div className="chapter-foot">
              <span>Clutter level:</span>
              <strong className="coral">99% overflowing 📦</strong>
            </div>
          </div>
          <div className="chapter">
            <div className="chapter-top">
              <span className="chapter-tag coral">Chapter 02</span>
              <span className="keycaps" aria-hidden="true">
                <kbd>Ctrl+C</kbd>
                <kbd>Ctrl+V</kbd>
              </span>
            </div>
            <h3>Death by relisting by hand</h3>
            <p className="muted">
              Listing on eBay and Vinted meant doing everything twice. Worse, when items sank after 2 days, you had to delete and
              re-upload them from scratch by hand.
            </p>
            <div className="chapter-foot">
              <span>Manual relisting:</span>
              <s className="coral">Delete &amp; re-upload</s>
            </div>
          </div>
          <div className="chapter">
            <div className="chapter-top">
              <span className="chapter-tag teal">Chapter 03</span>
              <span aria-hidden="true">🚀</span>
            </div>
            <h3>Spend time finding stock, not relisting</h3>
            <p className="muted">
              Stock &amp; List keeps your inventory in one central vault, pushes to <strong>eBay &amp; Vinted in 2 clicks</strong>,
              and automatically bumps stale items back to #1.
            </p>
            <div className="chapter-foot">
              <span>Result:</span>
              <strong className="teal">2 clicks &amp; auto-bumped ✨</strong>
            </div>
          </div>
        </div>

        <section className="about-notes">
          <div>
            <h3>Independent</h3>
            <p className="muted">
              Stock &amp; List isn’t affiliated with or endorsed by eBay or Vinted. It works in your own browser with the accounts
              you’re already signed in to, and you always press publish yourself. eBay and Vinted are trademarks of their owners.
            </p>
          </div>
          <div>
            <h3>Your data</h3>
            <p className="muted">
              Used only to run Stock &amp; List: no ads, no selling it on. See the <Link to="/privacy">privacy policy</Link>.
            </p>
          </div>
          <div className="actions">
            <Link to="/signup" className="button primary big cta">
              <FanIcon />
              Get started
            </Link>
            <a href="/#how" className="button outline big">
              See how it works
            </a>
          </div>
        </section>

        <footer className="landing-footer muted small">
          <span>© {new Date().getFullYear()} Stock & List</span>
          <span className="footer-links">
            <Link to="/privacy">Privacy</Link>
            <Link to="/login">Sign in</Link>
          </span>
        </footer>
      </div>
    </div>
  );
}
