/* End-to-end room lifecycle test against a running server.
 * Usage: node scripts/e2e-rooms.mjs <baseUrl> (default http://localhost:3100)
 * Validates the LOBBY/VOID room lifecycle and the privacy model headlessly
 * (no API keys, no funded escrow): rooms that never get funded are VOIDED
 * past their deadline, seats are preserved, and verifier results record
 * honestly. Also covers the invite-code and identity gates on reads.
 */
import { KeyPair } from "@nimiq/core";
import { sha256 } from "@noble/hashes/sha2.js";

const cronHeader = process.env.CRON_SECRET ? { "x-cron-secret": process.env.CRON_SECRET } : {};

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

const MSG_PREFIX = "\x16Nimiq Signed Message:\n";

function makeAuth() {
  const kp = KeyPair.generate();
  const publicKey = kp.publicKey.toHex();
  const message = `nimdares-login:${Date.now()}`;
  const digest = sha256(new TextEncoder().encode(`${MSG_PREFIX}${message.length}${message}`));
  const signature = kp.sign(digest).toHex();
  const auth = `Nimiq ${publicKey}:${signature}:${Buffer.from(message).toString("base64url")}`;
  return { auth, address: kp.toAddress().toUserFriendlyAddress() };
}

const alice = makeAuth();
const bob = makeAuth();
// Room create triggers escrow reads on first fetch; give the lifecycle enough
// headroom and wait for the deadline to pass instead of sleeping a fixed time.
const deadlineMs = Date.now() + 30_000;
const deadline = new Date(deadlineMs).toISOString();
const waitForDeadline = async () => {
  const remaining = deadlineMs - Date.now();
  if (remaining > 0) await new Promise((res) => setTimeout(res, remaining + 1_000));
};
let r;

// 0. The un-owned list must not reveal anyone's dares
r = await json(`${BASE}/api/dares`);
assert(r.status === 200 && Array.isArray(r.body?.dares), `list endpoint responds`);
assert(r.body?.dares?.length === 0, `list without owner reveals nothing`);

// 1. Create a team room (capacity 2)
r = await json(`${BASE}/api/dares`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: alice.auth },
  body: JSON.stringify({
    title: "Room lifecycle probe",
    description: "Two members; the room is never funded, so it must void at the deadline.",
    criteria: "Everyone submits completion proof by the deadline or is judged invalid.",
    asset: "NIM",
    amount: 1,
    deadline,
    verifierKind: "VISION",
    mode: "team",
    maxCapacity: 2,
  }),
});
assert(r.status === 201 && r.body?.ok === true, `create team room succeeds (${r.status})`);
const roomId = r.body?.dare?.id;
const code = r.body?.dare?.roomCode;
assert(typeof code === "string" && code.length === 6, `team room returns a 6-char invite code`);

// 2. Team room reads are gated by invite code or wallet identity
r = await json(`${BASE}/api/dares/${roomId}`);
assert(r.status === 403 && r.body?.codeRequired === true, `team room hidden without code (${r.status})`);
r = await json(`${BASE}/api/dares/${roomId}?code=${encodeURIComponent(code)}`);
assert(r.body?.dare?.status === "LOBBY", `room readable with the invite code`);
assert(r.body?.participants?.length === 1, `creator holds the first seat`);
assert(r.body?.dare?.roomCode === code, `invite code returned to a code holder`);
r = await json(`${BASE}/api/dares/${roomId}`, { headers: { authorization: alice.auth } });
assert(r.status === 200, `owner reads team room with wallet identity (${r.status})`);
r = await json(`${BASE}/api/dares/${roomId}`, { headers: { authorization: bob.auth } });
assert(r.status === 403, `guest without code cannot view team room (${r.status})`);

// 3. Bob joins with the code
r = await json(`${BASE}/api/dares/${roomId}/join`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: bob.auth },
  body: JSON.stringify({ roomCode: code }),
});
assert(r.status === 201, `bob joins team room (${r.status})`);
const bobSeatId = r.body?.participant?.id;
assert(typeof bobSeatId === "string", `bob receives a participant id`);

// 4. Bob's own seat proof is gated on funding (headless rooms are never
//    funded, so the request must reach the funding gate and stop there)
r = await json(`${BASE}/api/dares/${roomId}/seats/${bobSeatId}/proof`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: bob.auth },
  body: JSON.stringify({ proofImage: "data:image/png;base64,AAAA" }),
});
assert(r.status === 409, `seat proof requires funding first (${r.status})`);

// 5. Seat proof endpoint denies other identities before the funding gate
r = await json(`${BASE}/api/dares/${roomId}/seats/${bobSeatId}/proof`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: alice.auth },
  body: JSON.stringify({ proofImage: "data:image/png;base64,AAAA" }),
});
assert(r.status === 403, `seat proof is owner-scoped (${r.status})`);

// 6. Participants read the room with their wallet identity once seated
r = await json(`${BASE}/api/dares/${roomId}`, { headers: { authorization: bob.auth } });
assert(r.status === 200 && r.body?.participants?.length === 2, `participant reads the full room (${r.status})`);

// 7. Unfunded room voids once the deadline passes
await waitForDeadline();
r = await json(`${BASE}/api/cron/sweep`, { method: "POST", headers: cronHeader });
assert(r.status === 200 && r.body?.ok === true, `sweep runs (${JSON.stringify(r.body?.stats)})`);

r = await json(`${BASE}/api/dares/${roomId}?code=${encodeURIComponent(code)}`);
assert(r.body?.dare?.status === "VOIDED", `unfunded room voids at deadline (got ${r.body?.dare?.status})`);
assert(r.body?.dare?.verifierResult?.status === "INVALID", `voided room records INVALID verdict`);
assert((r.body?.participants ?? []).length === 2, `seats preserved after void`);

// 8. Room code does not admit late joiners once the room settles
r = await json(`${BASE}/api/dares/${roomId}/join`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: alice.auth },
  body: JSON.stringify({ roomCode: code }),
});
assert(r.status === 409, `late join after void rejected (${r.status})`);

// 9. Unfunded solo dare voids too; its reads stay owner-only throughout
const soloDeadlineMs = Date.now() + 30_000;
const soloDeadline = new Date(soloDeadlineMs).toISOString();
const waitForSoloDeadline = async () => {
  const remaining = soloDeadlineMs - Date.now();
  if (remaining > 0) await new Promise((res) => setTimeout(res, remaining + 1_000));
};
r = await json(`${BASE}/api/dares`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: alice.auth },
  body: JSON.stringify({
    title: "Solo lifecycle probe",
    description: "A solo dare whose owner never funds nor submits proof before the deadline.",
    criteria: "Submit completion proof by the deadline.",
    asset: "NIM",
    amount: 1,
    deadline: soloDeadline,
    verifierKind: "VISION",
  }),
});
assert(r.status === 201, `create solo probe (${r.status})`);
const soloId = r.body?.dare?.id;

r = await json(`${BASE}/api/dares/${soloId}`);
assert(r.status === 404, `solo dare hidden from unauthenticated reads (${r.status})`);
r = await json(`${BASE}/api/dares/${soloId}`, { headers: { authorization: bob.auth } });
assert(r.status === 404, `solo dare hidden from other wallets (${r.status})`);
r = await json(`${BASE}/api/dares/${soloId}`, { headers: { authorization: alice.auth } });
assert(r.status === 200, `owner reads their solo dare (${r.status})`);

await waitForSoloDeadline();
r = await json(`${BASE}/api/cron/sweep`, { method: "POST", headers: cronHeader });
r = await json(`${BASE}/api/dares/${soloId}`, { headers: { authorization: alice.auth } });
assert(r.body?.dare?.status === "VOIDED", `unfunded solo dare voids at deadline (got ${r.body?.dare?.status})`);
assert(r.body?.dare?.verifierResult?.status === "INVALID", `voided solo dare records INVALID verdict`);

console.log("done.");