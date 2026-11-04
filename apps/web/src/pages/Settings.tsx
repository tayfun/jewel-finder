import type { Account, Settings as SettingsType } from "@jf/shared";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { useAccount, useAuth } from "../auth";
import { ThemePicker } from "../components/ThemeToggle";
import { useExtension } from "../extension";

export function Settings() {
  const account = useAccount();
  const { setAccount, logout } = useAuth();
  const extension = useExtension();
  const [form, setForm] = useState<SettingsType>(account.settings);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    try {
      setAccount(await api<Account>("/api/me/settings", { method: "PATCH", json: form }));
      setStatus("Saved");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
      </div>
      <div className="grid-2">
        <form className="card" onSubmit={save}>
          <h2>Marketplaces</h2>
          <label>
            Currency
            <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value as SettingsType["currency"] })}>
              <option value="GBP">GBP (£)</option>
              <option value="EUR">EUR (€)</option>
              <option value="USD">USD ($)</option>
            </select>
          </label>
          <label>
            Vinted site
            <input value={form.vintedDomain} onChange={(e) => setForm({ ...form, vintedDomain: e.target.value.trim() })} />
            <small className="muted">e.g. www.vinted.co.uk, www.vinted.fr, www.vinted.de</small>
          </label>
          <label>
            eBay site
            <input value={form.ebayDomain} onChange={(e) => setForm({ ...form, ebayDomain: e.target.value.trim() })} />
            <small className="muted">e.g. www.ebay.co.uk, www.ebay.com, www.ebay.de</small>
          </label>
          <h2>Relisting</h2>
          <p className="muted small">
            Listings sink as they get older. After this many days a live listing is flagged so you can relist it, which puts
            it up again as a new listing and removes the old one.
          </p>
          <div className="grid-2">
            <label>
              Vinted: relist after (days)
              <input
                type="number"
                min={1}
                max={365}
                value={form.vintedRelistDays}
                onChange={(e) => setForm({ ...form, vintedRelistDays: e.target.valueAsNumber })}
              />
            </label>
            <label>
              eBay: relist after (days)
              <input
                type="number"
                min={1}
                max={365}
                value={form.ebayRelistDays}
                onChange={(e) => setForm({ ...form, ebayRelistDays: e.target.valueAsNumber })}
              />
            </label>
          </div>
          {error && <p className="error">{error}</p>}
          <div className="form-actions">
            {status && <span className="muted">{status}</span>}
            <button className="primary">Save</button>
          </div>
        </form>

        <div>
          <section className="card">
            <h2>Appearance</h2>
            <ThemePicker />
            <p className="muted small">Starts with your device's light or dark setting. Your choice is saved on this browser.</p>
          </section>
          <section className="card">
            <h2>Chrome extension</h2>
            {extension === null ? (
              <p className="muted">Checking…</p>
            ) : extension ? (
              <p>
                Installed <span className="muted">(v{extension})</span>. Use “List on Vinted/eBay” on any item, or open the
                extension's side panel.
              </p>
            ) : (
              <p>
                Not detected in this browser. <Link to="/extension">Install the extension</Link>
              </p>
            )}
          </section>
          <section className="card">
            <h2>Account</h2>
            <p className="muted">{account.email}</p>
            <button onClick={logout}>Sign out</button>
          </section>
        </div>
      </div>
    </>
  );
}
