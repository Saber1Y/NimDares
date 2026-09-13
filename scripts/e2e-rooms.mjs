/* End-to-end room lifecycle test against a running server.
 * Usage: node scripts/e2e-rooms.mjs <baseUrl> (default http://localhost:3100)
 * Validates the LOBBY/WOV room lifecycle headlessly (no API keys, no funded escrow):
 * rooms that never get funded are VOIDED past their deadline, seats are preserved,
 * and verifier results record honestly. Requires no API keys.
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

function makeAuth() {
  const kp = KeyPair.generate();
  const publicKey = kp.publicKey.toHex();
  const message = `nimdares-login:${Date.now()}`;
  const digest = sha256(new TextEncoder().encode(message));
  const signature = kp.sign(digest).toHex();
  const auth = `Nimiq ${publicKey}:${signature}:${Buffer.from(message).toString("base64url")}`;
  return { auth, address: kp.toAddress().toUserFriendlyAddress() };
}

const alice = makeAuth();
const bob = makeAuth();
const deadline = new Date(Date.now() + 5_000).toISOString();

// 1. Create a team room (capacity 2)
let r = await json(`${BASE}/api/dares`, {
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

// 2. Room starts in LOBBY with one seat
r = await json(`${BASE}/api/dares/${roomId}`);
assert(r.body?.dare?.status === "LOBBY", `room starts LOBBY`);
assert(r.body?.participants?.length === 1, `creator holds the first seat`);

// 3. Bob joins with the code
r = await json(`${BASE}/api/dares/${roomId}/join`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: bob.auth },
  body: JSON.stringify({ roomCode: code }),
});
assert(r.status === 201, `bob joins team room (${r.status})`);
const bobSeatId = r.body?.participant?.id;
assert(typeof bobSeatId === "string", `bob receives a participant id`);

// 4. Bob stores a seat proof (headless VISION stores the image data URL)
r = await json(`${BASE}/api/dares/${roomId}/seats/${bobSeatId}/proof`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: bob.auth },
  body: JSON.stringify({ proofImage: "data:image/png;base64,AAAA" }),
});
assert(r.status === 200 && r.body?.participant?.id === bobSeatId, `seat proof stored (${r.status})`);

// 5. Seat proof endpoint denies other identities
r = await json(`${BASE}/api/dares/${roomId}/seats/${bobSeatId}/proof`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: alice.auth },
  body: JSON.stringify({ proofImage: "data:image/png;base64,AAAA" }),
});
assert(r.status === 403, `seat proof is owner-scoped (${r.status})`);

// 6. Unfunded room voids once the deadline passes
await new Promise((res) => setTimeout(res, 6_000));
r = await json(`${BASE}/api/cron/sweep`, { method: "POST" });
assert(r.status === 200 && r.body?.ok === true, `sweep runs (${JSON.stringify(r.body?.stats)})`);

r = await json(`${BASE}/api/dares/${roomId}`);
assert(r.body?.dare?.status === "VOIDED", `unfunded room voids at deadline (got ${r.body?.dare?.status})`);
assert(r.body?.dare?.verifierResult?.status === "INVALID", `voided room records INVALID verdict`);
assert((r.body?.participants ?? []).length === 2, `seats preserved after void`);

// 7. Room code does not admit late joiners once the room settles
r = await json(`${BASE}/api/dares/${roomId}/join`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: alice.auth },
  body: JSON.stringify({ roomCode: code }),
});
assert(r.status === 409, `late join after void rejected (${r.status})`);

// 6. Unfunded solo dare voids too
const soloDeadline = new Date(Date.now() + 5_000).toISOString();
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
await new Promise((res) => setTimeout(res, 6_000));
r = await json(`${BASE}/api/cron/sweep`, { method: "POST" });
r = await json(`${BASE}/api/dares/${soloId}`);
assert(r.body?.dare?.status === "VOIDED", `unfunded solo dare voids at deadline (got ${r.body?.dare?.status})`);
assert(r.body?.dare?.verifierResult?.status === "INVALID", `voided solo dare records INVALID verdict`);

console.log("done.");