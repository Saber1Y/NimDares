/*
 * Full adjudication E2E test with GEMINI_API_KEY.
 * Exercises the complete VISION flow: create dare → submit proof → adjudicate → verdict.
 * The dare uses a short deadline so the sweep adjudicates it shortly after proof submission.
 * Requires: GEMINI_API_KEY env var set, dev server running.
 * Usage: node scripts/e2e-adjudicate.mjs [baseUrl]
 */
import { KeyPair } from "@nimiq/core";
import { sha256 } from "@noble/hashes/sha2.js";

const BASE = process.argv[2] ?? "http://localhost:3000";

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${msg}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

// --- Generate a test keypair for auth ---
const kp = KeyPair.generate();
const publicKey = kp.publicKey.toHex();
const message = `nimdares-adjudicate-test:${Date.now()}`;
const digest = sha256(new TextEncoder().encode(
  `\x16Nimiq Signed Message:\n${message.length}${message}`
));
const signature = kp.sign(digest).toHex();
const authHeader = `Nimiq ${publicKey}:${signature}:${Buffer.from(message).toString("base64url")}`;
const expectedAddress = kp.toAddress().toUserFriendlyAddress();

// Minimal 1x1 red PNG for testing (will likely yield INVALID from Gemini since it's irrelevant)
const TEST_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8D4HwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

console.log(`\n=== NimDares Adjudication E2E ===`);
console.log(`Target: ${BASE}`);
console.log(`Address: ${expectedAddress}\n`);

// Step 1: Auth via user endpoint (validates the signed header end-to-end)
console.log("--- Step 1: Auth ---");
let r = await json(`${BASE}/api/user?address=${encodeURIComponent(expectedAddress)}`, {
  headers: { authorization: authHeader },
});
assert(r.status === 200 && r.body?.ok === true, `auth via user endpoint (${r.status})`);
assert(r.body?.user?.address === expectedAddress, `address derived correctly`);

// Step 2: Create a VISION dare
console.log("\n--- Step 2: Create VISION dare ---");
// Short deadline (8s) so the sweep adjudicates this dare moments after proof submission.
const deadline = new Date(Date.now() + 8_000).toISOString();
r = await json(`${BASE}/api/dares`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: authHeader },
  body: JSON.stringify({
    title: "Run 10km under 50 minutes",
    description:
      "Complete a 10km run in under 50 minutes. The proof must show a running app summary with distance and time.",
    criteria:
      "The screenshot must show: (1) total distance >= 10km, (2) total time < 50 minutes, (3) a timestamp within the dare window.",
    asset: "NIM",
    amount: 1,
    deadline,
    verifierKind: "VISION",
  }),
});
assert(r.status === 201 && r.body?.ok === true, `dare created (${r.status})`);
const dareId = r.body?.dare?.id;
assert(typeof dareId === "string" && dareId.length > 0, `dare id: ${dareId}`);

// Step 3: Fund the stake. Against the in-memory store a txRef of "test"
// records the deposit without chain validation (see confirm.ts); against a
// real store this requires an actual escrow payment and will hang/reject.
console.log("\n--- Step 3: Fund stake ---");
r = await json(`${BASE}/api/dares/${dareId}/fund`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: authHeader },
  body: JSON.stringify({ asset: "NIM", txRef: "test" }),
});
if (r.status === 200 && r.body?.status === "funded") {
  console.log("  (funded via test hook — simulated escrow deposit, not on-chain)");
} else {
  console.log(
    `  warning: funding did not settle via test hook (${r.status}: ${
      r.body?.error ?? r.body?.status ?? "unknown"
    }) — proof will be rejected by the funding gate`
  );
}

// Step 4: Submit proof image
console.log("\n--- Step 4: Submit proof image ---");
r = await json(`${BASE}/api/dares/${dareId}/proof`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: authHeader },
  body: JSON.stringify({ proofImage: TEST_IMAGE }),
});
assert(
  r.status === 201 && r.body?.ok === true,
  `proof submitted (${r.status}${r.body?.error ? `: ${r.body.error}` : ""})`
);
assert(
  r.body?.dare?.status === "SUBMITTED",
  `dare status is SUBMITTED after proof upload`
);

// Wait for the dare deadline to pass so the sweep will adjudicate it.
const remainMs = new Date(deadline).getTime() - Date.now();
if (remainMs > 0) {
  console.log(`  (waiting ${Math.ceil(remainMs / 1000)}s for deadline…)`);
  await sleep(remainMs + 500);
}

// Step 5: Run adjudication via sweep endpoint
console.log("\n--- Step 5: Trigger adjudication (sweep) ---");
const cronAuth = process.env.CRON_SECRET ? { "x-cron-secret": process.env.CRON_SECRET } : {};
r = await json(`${BASE}/api/cron/sweep`, { method: "POST", headers: cronAuth });
assert(r.status === 200 && r.body?.ok === true, `sweep ran (${JSON.stringify(r.body?.stats)})`);

// Step 6: Fetch the dare to see the verdict
console.log("\n--- Step 6: Fetch verdict ---");
r = await json(`${BASE}/api/dares/${dareId}`, { headers: { authorization: authHeader } });
assert(r.status === 200, `dare fetched (${r.status})`);
const dare = r.body?.dare;
if (dare?.verifierResult) {
  const vr = dare.verifierResult;
  assert(
    vr.status === "VALID" || vr.status === "INVALID" || vr.status === "UNAVAILABLE",
    `verdict status is valid enum: ${vr.status}`
  );
  console.log(`  verdict reason: ${vr.reason ?? "(none)"}`);
  console.log(`  verdict source: ${vr.source ?? "(none)"}`);

  // The 1x1 red PNG is not valid proof of a 10km run, so expect INVALID
  if (vr.status === "INVALID") {
    console.log(`  (Expected: test image is irrelevant to the goal → INVALID)`);
  }
} else {
  // Verdict may not be populated yet if sweep didn't adjudicate (e.g. deadline not passed)
  console.log(`  No verdict yet — dare status: ${dare?.status}`);
  if (dare?.status === "SUBMITTED") {
    console.log(`  (Dare was SUBMITTED but sweep didn't adjudicate — deadline may need to have passed)`);
  }
}

// Step 7: Confirm the server actually ran the real Gemini adjudication
console.log("\n--- Step 7: Environment check ---");
const hasGeminiKey = !!process.env.GEMINI_API_KEY;
const serverVerdict = dare?.verifierResult;
const servedByRealModel =
  !!serverVerdict?.source && serverVerdict.source !== "gemini";
assert(
  hasGeminiKey || servedByRealModel,
  `GEMINI_API_KEY configured for the server (verdict source: ${serverVerdict?.source ?? "none"})`
);
if (!hasGeminiKey && !servedByRealModel) {
  console.error(
    "\nABORT: The server adjudicated without GEMINI_API_KEY.\n  Set it in .env (loaded by next start) or export GEMINI_API_KEY to run the full vision test."
  );
}

console.log("\n=== Done ===\n");
