// Adds every existing account to the admin dashboard's user directory. Accounts join it on their
// own when they sign in or open the app; this catches the ones that haven't since it was deployed.
// Safe to run again: it only refreshes counts (and leaves "last active" alone for known users).
//
//   CLOUDFLARE_API_TOKEN=…  (Account › Workers Scripts › Read)
//   CLOUDFLARE_ACCOUNT_ID=…
//   JF_TOKEN=…              (an admin's token: localStorage["jf.token"] on the web app)
//   JF_URL=https://…        (the deployed app)
//   node scripts/backfill-directory.mjs
const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, JF_TOKEN, JF_URL } = process.env;
if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID || !JF_TOKEN || !JF_URL) {
  throw new Error("Set CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, JF_TOKEN and JF_URL.");
}

async function cf(path) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}${path}`, {
    headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` },
  });
  const body = await res.json();
  if (!body.success) throw new Error(`Cloudflare API ${path}: ${JSON.stringify(body.errors)}`);
  return body;
}

const namespaces = (await cf("/workers/durable_objects/namespaces?per_page=1000")).result;
const ns = namespaces.find((n) => n.script === "jewel-finder" && n.class === "AccountDO");
if (!ns) throw new Error("No AccountDO namespace for the jewel-finder Worker in this account.");

const ids = [];
let cursor = "";
do {
  const page = await cf(`/workers/durable_objects/namespaces/${ns.id}/objects?limit=1000${cursor ? `&cursor=${cursor}` : ""}`);
  ids.push(...page.result.filter((o) => o.hasStoredData !== false).map((o) => o.id));
  cursor = page.result_info?.cursor ?? "";
} while (cursor);
console.log(`${ids.length} account objects`);

let synced = 0;
let missing = 0;
for (let i = 0; i < ids.length; i += 100) {
  const res = await fetch(new URL("/api/admin/sync", JF_URL), {
    method: "POST",
    headers: { Authorization: `Bearer ${JF_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ids: ids.slice(i, i + 100) }),
  });
  if (!res.ok) throw new Error(`/api/admin/sync: ${res.status} ${await res.text()}`);
  const body = await res.json();
  synced += body.synced;
  missing += body.missing.length;
}
// "Missing" are objects without an account, e.g. from a sign-up that failed part way.
console.log(`Synced ${synced} accounts (${missing} objects had no account).`);
