import { Link } from "react-router";
import { FanIcon } from "../components/Brand";
import { DemoStage, DemoTelemetry, useLandingDemo } from "../components/LandingDemo";
import { SiteHeader } from "../components/SiteHeader";

const HIGHLIGHTS = [
  {
    colour: "teal",
    title: "Your stock, in one place",
    body: "Add an item once with its photos, measurements, SKU and price. Or import the listings you already have.",
  },
  {
    colour: "coral",
    title: "Two clicks to list on eBay and Vinted",
    body: "The extension fills in the title, photos, category, condition and price. You check it and press publish.",
  },
  {
    colour: "violet",
    title: "Relist and bump to the top",
    body: "Stale listings get flagged. One click relists them and removes the old listing, so they're fresh again.",
  },
];

export function Landing() {
  const demo = useLandingDemo();
  return (
    <div className="landing-page">
      <div className="landing">
        <SiteHeader />

        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow-pill">
              <span className="live-dot" aria-hidden="true" />
              <span>Built for eBay &amp; Vinted resellers</span>
              <span className="sep" aria-hidden="true">
                |
              </span>
              <strong>Zero manual re-uploads</strong>
            </span>
            <h1>
              Spend your time finding stock, <span className="accent">not relisting it.</span>
            </h1>
            <p className="lead">
              Stock &amp; List keeps your inventory in one place and lists it on <span className="mk-ul ebay">eBay</span> and{" "}
              <span className="mk-ul vinted">Vinted</span> in a couple of clicks. It relists and bumps items back to the top
              too, so you can stop deleting and re-uploading by hand.
            </p>
            <div className="actions">
              <Link to="/signup" className="button primary big cta">
                <FanIcon />
                Get started with your email
              </Link>
              <a href="#how" className="button outline big">
                See how it works
              </a>
            </div>
            <p className="muted small">Sign-up takes seconds. No business details needed.</p>
          </div>
          <DemoTelemetry demo={demo} />
        </section>

        <section id="how" className="landing-section demo-section">
          <div className="section-head">
            <h2 className="section-title">How it works</h2>
            <p className="muted">Watch one item go from your stock to both sites, sink down the feeds, and bounce back.</p>
          </div>
          <DemoStage demo={demo} />
          <div id="features" className="highlights">
            {HIGHLIGHTS.map((h, i) => (
              <div key={h.title} className={`highlight ${h.colour}`}>
                <span className="highlight-num">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{h.title}</h3>
                  <p className="muted">{h.body}</p>
                </div>
              </div>
            ))}
          </div>
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
    </div>
  );
}
