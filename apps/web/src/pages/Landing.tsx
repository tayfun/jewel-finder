import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ThemeToggle } from "../components/ThemeToggle";
import { Logo } from "../components/Brand";

const FEATURES = [
  {
    icon: "📦",
    title: "One inventory for everything",
    body: "Photos, sizes, prices and costs in one place, so you always know what you have and what it's worth.",
  },
  {
    icon: "🚀",
    title: "List everywhere in a click",
    body: "Push an item to Vinted and eBay at once. We fill in the listing forms so you don't retype or re-upload anything.",
  },
  {
    icon: "🔁",
    title: "Relist & bump to the top",
    body: "Stale listings get buried. Refresh them and move them back to the top without deleting and recreating them by hand.",
  },
  {
    icon: "⬇️",
    title: "Import what you already sell",
    body: "Bring your existing Vinted and eBay listings across in one go. No need to start your inventory from scratch.",
  },
  {
    icon: "🏷️",
    title: "Find the treasure",
    body: "Spot underpriced gems on the platforms you already use and save them straight into your stock.",
  },
  {
    icon: "📈",
    title: "Know your numbers",
    body: "See stock value, potential profit and what's live where at a glance. Mark an item sold and its other listings get flagged.",
  },
];

const STEPS = [
  { title: "Add or import your items", body: "Snap photos and add details once, or import the listings you already have." },
  { title: "List on Vinted and eBay", body: "Our Chrome extension opens each site and fills in the listing for you. You review it and press publish." },
  { title: "Keep them fresh", body: "Relist and bump items with a click, and keep every platform in sync when something sells." },
];

/** Three cards, like the logo; they fan out when the button is hovered. */
function FanIcon() {
  return (
    <svg className="fan-icon" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <rect x="6" y="3" width="8" height="13" rx="2" fill="#b9a2ff" />
      <rect x="6" y="3" width="8" height="13" rx="2" fill="#ffc53d" />
      <rect x="6" y="3" width="8" height="13" rx="2" fill="#ff6b57" />
    </svg>
  );
}

export function Landing() {
  // The header tightens up once the page scrolls.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="landing">
      <div className={`landing-nav-wrap ${scrolled ? "scrolled" : ""}`}>
        <header className="landing-nav">
          <Link to="/" className="brand brand-lg" aria-label="Stock & List home">
            <Logo size={46} />
          </Link>
          <span className="brand-tagline">One stock. Every marketplace.</span>
          <nav className="hide-sm" aria-label="Sections">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <Link to="/extension">Chrome extension</Link>
          </nav>
          <div className="actions">
            <ThemeToggle />
            <Link to="/login" className="button outline">
              Sign in
            </Link>
            <Link to="/signup" className="button primary cta">
              <FanIcon />
              Get started
            </Link>
          </div>
        </header>
      </div>

      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">For eBay &amp; Vinted resellers</span>
          <h1>
            Spend your time finding stock, <span className="accent">not relisting it.</span>
          </h1>
          <p className="lead">
            Stock & List keeps your inventory in one place and lists it on eBay and Vinted in a couple of clicks. It
            relists and bumps items back to the top too, so you can stop deleting and re-uploading by hand.
          </p>
          <div className="actions">
            <Link to="/signup" className="button primary big">
              Get started with your email
            </Link>
            <a href="#how" className="button ghost big">
              See how it works
            </a>
          </div>
          <p className="muted small">Sign-up takes seconds. No business details needed.</p>
        </div>

        <div className="hero-visual" aria-hidden="true">
          <div className="mock-card back" />
          <div className="mock-card">
            <div className="mock-photo">👖</div>
            <div className="mock-body">
              <strong>Levi's 501 jeans W32</strong>
              <span className="muted small">Levi's · Very good</span>
              <div className="mock-row">
                <strong>£25.00</strong>
                <span className="muted small">profit £16.50</span>
              </div>
              <div className="listing-badges">
                <span className="badge mk-vinted ls-listed">Vinted</span>
                <span className="badge mk-ebay ls-listed">eBay</span>
              </div>
            </div>
          </div>
          <div className="mock-toast">
            <span>🔁</span> Bumped to the top on Vinted
          </div>
        </div>
      </section>

      <section id="features" className="landing-section">
        <h2 className="section-title">Everything a reseller repeats, done for you</h2>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="feature">
              <span className="feature-icon">{f.icon}</span>
              <h3>{f.title}</h3>
              <p className="muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="landing-section">
        <h2 className="section-title">How it works</h2>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="step-num">{i + 1}</span>
              <h3>{s.title}</h3>
              <p className="muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="cta-band">
        <h2>Ready to list less and sell more?</h2>
        <p>All we need is your email. You'll be adding items in under a minute.</p>
        <Link to="/signup" className="button primary big">
          Create your account
        </Link>
      </section>

      <footer className="landing-footer muted small">
        <span>© {new Date().getFullYear()} Stock & List</span>
        <span className="footer-links">
          <Link to="/privacy">Privacy</Link>
          <Link to="/login">Sign in</Link>
        </span>
      </footer>
    </div>
  );
}
