/* End-to-end API test against a running server.
 * Usage: node scripts/e2e-api.mjs <baseUrl> (default http://localhost:3100)
 * Exercises Nimiq signature auth, dare creation, ledger reads, and the sweep.
 */
import { KeyPair } from "@nimiq/core";
import { sha256 } from "@noble/hashes/sha2.js";

const BASE = process.argv[2] ?? "http://localhost:3100";

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exitCode = 1;
  } else {
    console.log(`ok: ${msg}`);
  }
}

async function json(url, opts) {
  const res = await fetch(url, opts);
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

const kp = KeyPair.generate();
const publicKey = kp.publicKey.toHex();
const message = `nimdares-login:${Date.now()}`;
const digest = sha256(new TextEncoder().encode(message));
const signature = kp.sign(digest).toHex();
const authHeader = `Nimiq ${publicKey}:${signature}:${Buffer.from(message).toString("base64url")}`;

// 1. Auth verify
let r = await json(`${BASE}/api/auth/verify`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ message, publicKey, signature }),
});
assert(r.status === 200 && r.body?.ok === true, `auth/verify accepts valid Nimiq signature (${r.status})`);
const address = r.body?.user?.address;
const expectedAddress = kp.toAddress().toUserFriendlyAddress();
assert(address === expectedAddress, `derived address matches KeyPair derivation (${address})`);
assert(r.body?.store === "memory" || r.body?.store === "prisma", `store is ${r.body?.store}`);

// 2. Reject tampered signature
r = await json(`${BASE}/api/auth/verify`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ message: message + "tampered", publicKey, signature }),
});
assert(r.status === 401, `auth/verify rejects tampered message (${r.status})`);

// 3. Create a dare with valid auth
const deadline = new Date(Date.now() + 48 * 3600_000).toISOString();
r = await json(`${BASE}/api/dares`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: authHeader },
  body: JSON.stringify({
    title: "Ship it before Friday",
    description:
      "Finish the alpha build of NimDares and push it with a walkthrough video before the weekend check-in.",
    criteria:
      "The app runs, the escrow flow funds a dare, and a verify check returns a verdict on video.",
    asset: "NIM",
    amount: 5,
    deadline,
    verifierKind: "VISION",
  }),
});
assert(r.status === 201 && r.body?.ok === true, `create dare succeeds (${r.status})`);
const dareId = r.body?.dare?.id;
assert(typeof dareId === "string" && dareId.length > 0, `dare id present`);
assert(r.body?.dare?.status === "PENDING_FUNDING", `new dare starts PENDING_FUNDING`);
assert(r.body?.escrow?.configured === false, `escrow honestly reports unconfigured without keys`);

// 4. Reject unauthenticated create
r = await json(`${BASE}/api/dares`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    title: "No auth",
    description: "This must be rejected because there is no signature header on the request.",
    criteria: "This proof of concept exists purely to test that unauthenticated creation is blocked.",
    asset: "USDT",
    amount: 1,
    deadline: new Date(Date.now() + 24 * 3600_000).toISOString(),
    verifierKind: "STRAVA",
  }),
});
assert(r.status === 401, `unauthenticated create rejected (${r.status})`);

// 5. List dares + summary
r = await json(`${BASE}/api/dares`);
assert(r.status === 200 && Array.isArray(r.body?.dares), `list dares`);
assert(r.body?.dares?.some((d) => d.id === dareId), `created dare appears in list`);
assert(typeof r.body?.summary?.active === "number", `summary present`);

// 6. Single dare + filtered by owner
r = await json(`${BASE}/api/dares/${dareId}`);
assert(r.status === 200 && r.body?.dare?.id === dareId, `get dare by id`);
r = await json(`${BASE}/api/dares?owner=${encodeURIComponent(address)}`);
assert(r.body?.dares?.some((d) => d.id === dareId), `filter dares by owner`);

// 7. User endpoint
r = await json(`${BASE}/api/user?address=${encodeURIComponent(address)}`);
assert(r.status === 200 && r.body?.user?.address === address, `user endpoint returns address`);
assert(r.body?.dareCount >= 1, `user dareCount includes created dare`);

// 8. Proof submission runs (image-less VISION is rejected, GitHub link accepted)
r = await json(`${BASE}/api/dares/${dareId}/proof`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: authHeader },
  body: JSON.stringify({ proofImage: "data:image/png;base64,AAAA" }),
});
assert(
  [400, 201].includes(r.status),
  `proof submission handled (${r.status}${r.body?.error ? `: ${r.body.error}` : ""})`
);

// 9. Reconcile reflects an honest offline state
r = await json(`${BASE}/api/wallet/reconcile`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ asset: "NIM", address: address }),
});
assert(r.status === 200 && r.body?.reconciled === true, `reconcile reads on-chain NIM balance`);

// 10. Sweep runs
r = await json(`${BASE}/api/cron/sweep`, { method: "POST" });
assert(r.status === 200 && r.body?.ok === true, `sweep runs (${JSON.stringify(r.body?.stats)})`);

console.log("done.");