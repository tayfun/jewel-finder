import { useEffect, useState } from "react";
import { Link } from "react-router";
import { FanIcon, Wordmark } from "./Brand";
import { ThemeToggle } from "./ThemeToggle";

/**
 * The header of the public pages (landing, privacy): a floating bar with the logo, section links and the
 * sign-in / get-started buttons. It tightens up once the page scrolls.
 */
export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className={`landing-nav-wrap ${scrolled ? "scrolled" : ""}`}>
      <header className="landing-nav">
        <Link to="/" className="brand brand-lg" aria-label="Stock & List home">
          <img src="/favicon.svg" alt="" width={46} height={46} className="logo-mark" />
          <span className="brand-text">
            <Wordmark />
            <span className="brand-tagline">One stock. Every marketplace.</span>
          </span>
        </Link>
        <nav className="hide-sm" aria-label="Sections">
          {/* Plain links: they also work from other pages, landing on the home page's section. */}
          <a href="/#features">Features</a>
          <a href="/#how">How it works</a>
          <Link to="/privacy">Privacy</Link>
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
  );
}
