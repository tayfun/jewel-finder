import { Link } from "react-router";
import { ThemeToggle } from "../components/ThemeToggle";
import { Logo } from "../components/Brand";

const UPDATED = "3 November 2026";
/** Set VITE_CONTACT_EMAIL in apps/web/.env; shown for privacy requests. */
const CONTACT = import.meta.env.VITE_CONTACT_EMAIL || null;

function Contact() {
  return CONTACT ? <a href={`mailto:${CONTACT}`}>{CONTACT}</a> : <>the contact address on our Chrome Web Store listing</>;
}

/** Privacy policy for the web app and the Chrome extension (linked from the Web Store listing). */
export function Privacy() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <Link to="/" className="brand">
          <Logo size={32} />
        </Link>
        <div className="actions">
          <ThemeToggle />
        </div>
      </header>

      <article className="legal">
        <h1>Privacy policy</h1>
        <p className="muted">Last updated {UPDATED}</p>

        <p>
          Stock & List helps resellers keep their inventory in one place and list it on Vinted and eBay. This policy covers
          the Stock & List web app and the Stock & List Chrome extension: what we collect, why, and who else handles it.
          We don't sell your data, show ads, or track you across other websites.
        </p>

        <h2>What we collect</h2>
        <ul>
          <li>
            <strong>Your account:</strong> your email address and a password, which we store only as a salted hash.
          </li>
          <li>
            <strong>Your inventory:</strong> the items you add or import (titles, descriptions, prices, costs, notes, book
            details, package sizes), their photos, your settings, and the Vinted/eBay listings you link to them.
          </li>
          <li>
            <strong>Technical data:</strong> when you use the app, our hosting provider processes your IP address and
            request details to serve and protect the site. If something breaks, we record an error report with technical
            details (browser, page, error message) and your account ID, but not your email or item contents.
          </li>
        </ul>

        <h2>How we use it</h2>
        <p>
          Only to provide Stock & List: to sign you in, store and show your inventory, fill in listings for you, and find
          and fix problems. We don't use your data for advertising, and we don't build profiles of you.
        </p>

        <h2>The Chrome extension</h2>
        <ul>
          <li>It stores your sign-in token in the extension's own storage so you stay signed in.</li>
          <li>
            When you start a listing, it opens the Vinted or eBay sell page and fills in the form with that item's details
            and photos. It only reads those marketplace pages to find the form fields and, once you publish, the address
            of your new listing, which it saves to the item in your inventory.
          </li>
          <li>
            When you check an item's price, it opens eBay and Vinted search pages for that item in background tabs,
            reads the prices of similar listings shown there, and saves them with the item so you can see how the
            suggested price was worked out. The tabs close again once read. If AI is set up, the item's details,
            up to two of its photos and the titles and prices of those listings are sent to Google's Gemini API to
            judge which listings are really the same item (see below).
          </li>
          <li>
            When you relist an item, it does both: it fills in a new listing for you to publish, then opens the old one
            so you can delete or end it.
          </li>
          <li>
            When you import listings, it reads the listings page you have open on Vinted or eBay to show you what's there,
            and for each listing you pick, it opens that listing to copy its title, description, price, details and
            photos into your inventory. It downloads the photos from Vinted's and eBay's image servers, and eBay
            descriptions from eBay's description server. It only does this after you start an import and pick listings.
          </li>
          <li>
            It only runs on Vinted, eBay and the Stock & List site. It doesn't read your browsing history, other
            websites, or your marketplace messages, and it collects no analytics.
          </li>
        </ul>
        <p>
          The use of information received from the extension adheres to the{" "}
          <a href="https://developer.chrome.com/docs/webstore/program-policies/policies" target="_blank" rel="noreferrer">
            Chrome Web Store User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>

        <h2>AI: auto-fill and price checks</h2>
        <p>
          When you ask for an AI suggestion, we send that item's photos, and the title, description and notes you've
          written, to Google's Gemini API. Google processes them under the{" "}
          <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noreferrer">
            Gemini API terms
          </a>{" "}
          to return the suggestion. Nothing is saved to your item until you choose to apply it.
        </p>
        <p>
          When you check an item's price, we send its details (title, description, brand, size, condition, book
          details), up to two of its photos, and the titles and prices of the comparable listings found, to the
          Gemini API, which says which of those listings are the same item. Its verdicts and notes are saved with the
          price check. Your private notes and costs are not sent.
        </p>
        <p>Nothing is sent to Google unless you click one of these buttons.</p>

        <h2>Who handles your data</h2>
        <ul>
          <li>
            <strong>Cloudflare</strong> hosts the app and stores your account, inventory and photos.
          </li>
          <li>
            <strong>Google</strong> (Gemini API) processes photos and text when you use auto-fill or check prices.
          </li>
          <li>
            <strong>Sentry</strong> receives error reports so we can fix bugs.
          </li>
        </ul>
        <p>
          Vinted and eBay receive what you choose to publish there, under their own privacy policies. Your data may be
          processed outside the UK and EEA by these providers, under their standard data-protection safeguards.
        </p>

        <h2>Cookies and local storage</h2>
        <p>
          We don't use tracking or advertising cookies. The web app keeps your sign-in token and your light/dark theme
          choice in your browser's local storage.
        </p>

        <h2>How long we keep it</h2>
        <p>
          Your inventory stays until you delete it. Deleting an item deletes its photos. Your account and its data stay
          until you ask us to delete them. Error reports and server logs are kept for a limited time by our providers and
          then deleted.
        </p>

        <h2>Your rights</h2>
        <p>
          You can see and change your inventory in the app at any time. You can also ask us for a copy of your data, to
          correct it, or to delete your account and everything in it, by emailing <Contact />. If you're in the UK or
          EEA, you can also complain to your data-protection authority (in the UK, the{" "}
          <a href="https://ico.org.uk/make-a-complaint/" target="_blank" rel="noreferrer">
            ICO
          </a>
          ).
        </p>

        <h2>Children</h2>
        <p>Stock & List is for adults selling online and isn't directed at children.</p>

        <h2>Changes</h2>
        <p>
          If we change this policy, we'll update this page and the date at the top. For significant changes, we'll let you
          know by email.
        </p>

        <h2>Contact</h2>
        <p>
          Questions or requests: <Contact />.
        </p>
      </article>

      <footer className="landing-footer muted small">
        <span>© {new Date().getFullYear()} Stock & List</span>
        <Link to="/">Home</Link>
      </footer>
    </div>
  );
}
