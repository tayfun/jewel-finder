import type { Credentials } from "@jf/shared";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { useAuth } from "../auth";
import { Logo } from "../components/Brand";

/** Shared submit/redirect logic for the sign-in and sign-up forms. */
function useAuthForm(action: (creds: Credentials) => Promise<void>) {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await action({ email, password });
      navigate(from, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return { email, setEmail, password, setPassword, error, busy, submit, from };
}

function Brand() {
  return (
    <Link to="/" className="brand">
      <Logo size={34} />
    </Link>
  );
}

export function Login() {
  const { account, login } = useAuth();
  const f = useAuthForm(login);
  if (account) return <Navigate to={f.from} replace />;

  return (
    <div className="login-page">
      <form className="card login-card" onSubmit={f.submit}>
        <Brand />
        <h1>Welcome back</h1>
        <p className="muted">Sign in to your inventory.</p>
        <label>
          Email
          <input
            type="email"
            required
            autoFocus
            autoComplete="email"
            value={f.email}
            onChange={(e) => f.setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            required
            autoComplete="current-password"
            value={f.password}
            onChange={(e) => f.setPassword(e.target.value)}
          />
        </label>
        {f.error && <p className="error">{f.error}</p>}
        <button className="primary" disabled={f.busy}>
          {f.busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="muted small center">
          New to Stock & List? <Link to="/signup">Create an account</Link>
        </p>
      </form>
    </div>
  );
}

export function Signup() {
  const { account, register } = useAuth();
  const f = useAuthForm(register);
  if (account) return <Navigate to={f.from} replace />;

  return (
    <div className="signup-page">
      <aside className="signup-pitch">
        <Brand />
        <div>
          <h1>Up and running in seconds.</h1>
          <p>All we need is your email. No business details, no shop names, no forms to wade through.</p>
          <ul className="checklist">
            <li>List on Vinted and eBay from one place</li>
            <li>Relist and bump to the top without the busywork</li>
            <li>Import the listings you already have</li>
          </ul>
        </div>
        <span className="small">Already selling? You'll be adding items in under a minute.</span>
      </aside>

      <main className="signup-main">
        <form className="signup-form" onSubmit={f.submit}>
          <h2>Create your account</h2>
          <label>
            Your email
            <input
              type="email"
              required
              autoFocus
              autoComplete="email"
              placeholder="you@example.com"
              value={f.email}
              onChange={(e) => f.setEmail(e.target.value)}
            />
          </label>
          <label>
            Choose a password
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={f.password}
              onChange={(e) => f.setPassword(e.target.value)}
            />
          </label>
          {f.error && <p className="error">{f.error}</p>}
          <button className="primary big" disabled={f.busy}>
            {f.busy ? "Creating your account…" : "Get started"}
          </button>
          <p className="muted small center">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
          <p className="muted small center">
            By signing up you agree to how we handle your data in our <Link to="/privacy">privacy policy</Link>.
          </p>
        </form>
      </main>
    </div>
  );
}
