import { Link } from "react-router";
import { FanIcon } from "../components/Brand";
import { SiteHeader } from "../components/SiteHeader";

/** What Stock & List is, who it's for, and how it works with eBay and Vinted. */
export function About() {
  return (
    <div className="landing-page">
      <div className="landing">
        <SiteHeader />

        <article className="legal about">
          <span className="eyebrow">About</span>
          <h1>One stock list for every site you sell on</h1>
          <p className="lead">
            Stock &amp; List is an inventory app with a Chrome extension, made for people who resell second-hand on eBay
            and Vinted: books, clothes, records, homeware and everything in between.
          </p>

          <h2>What it does</h2>
          <ul>
            <li>Keeps your stock in one place: photos, details, prices, costs and where each item is listed.</li>
            <li>Fills in eBay's and Vinted's own listing forms for you, then records the new listing once you publish.</li>
            <li>Flags listings that have gone stale and relists them, so they're back at the top of the feeds.</li>
            <li>When something sells, flags its other listings so you can end them before it sells twice.</li>
            <li>Imports the listings you already have, and checks prices against comparable sales.</li>
          </ul>

          <h2>How it works with eBay and Vinted</h2>
          <p>
            The extension works in your own browser, with the eBay and Vinted accounts you're already signed in to. It
            fills in forms and gets steps ready, and you always press publish or confirm a delete yourself. We never ask
            for your marketplace passwords.
          </p>

          <h2>Independent</h2>
          <p>
            Stock &amp; List isn't affiliated with or endorsed by eBay or Vinted. eBay and Vinted are trademarks of their
            owners.
          </p>

          <h2>Your data</h2>
          <p>
            We only use your data to run Stock &amp; List: no ads, no selling it on. The <Link to="/privacy">privacy policy</Link>{" "}
            has the details.
          </p>

          <div className="actions about-cta">
            <Link to="/signup" className="button primary big cta">
              <FanIcon />
              Get started
            </Link>
            <a href="/#how" className="button outline big">
              See how it works
            </a>
          </div>
        </article>

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
