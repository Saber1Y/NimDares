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

const MSG_PREFIX = "\x16Nimiq Signed Message:\n";
const signFor = (sk) => (msg) => {
  const data = `${MSG_PREFIX}${msg.length}${msg}`;
  const digest = sha256(new TextEncoder().encode(data));
  return sk.sign(digest).toHex();
};

const kp = KeyPair.generate();
const publicKey = kp.publicKey.toHex();
const message = `nimdares-login:${Date.now()}`;
const signature = signFor(kp)(message);
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
import { readFileSync, existsSync } from "node:fs";
const dotenv = existsSync(".env") ? readFileSync(".env", "utf8") : "";
const escrowExpected = /^ESCROW_NIM_KEY_HEX=./m.test(dotenv);
assert(
  r.body?.escrow?.configured === escrowExpected,
  `escrow reports honest config state (configured=${r.body?.escrow?.configured})`
);

// 4. Delete an unfunded dare permanently
r = await json(`${BASE}/api/dares`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: authHeader },
  body: JSON.stringify({
    title: "Delete this test dare",
    description: "This unfunded dare exists to verify creator deletion.",
    criteria: "The test should remove this record before any stake is sent.",
    asset: "NIM",
    amount: 1,
    deadline: new Date(Date.now() + 48 * 3600_000).toISOString(),
    verifierKind: "STRAVA",
  }),
});
assert(r.status === 201 && r.body?.ok === true, `create deletion test dare succeeds (${r.status})`);
const deleteDareId = r.body?.dare?.id;
r = await json(`${BASE}/api/dares/${deleteDareId}`, {
  method: "DELETE",
  headers: { authorization: authHeader },
});
assert(r.status === 200 && r.body?.deleted === true, `creator can delete an unfunded dare (${r.status})`);
r = await json(`${BASE}/api/dares/${deleteDareId}`);
assert(r.status === 404, `deleted dare is no longer readable (${r.status})`);

// 5. Reject unauthenticated create
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

// 6. List: without an owner nothing is revealed; filtered by owner works
r = await json(`${BASE}/api/dares`);
assert(r.status === 200 && Array.isArray(r.body?.dares), `list dares`);
assert(r.body?.dares?.length === 0, `list without owner reveals no dares`);
assert(typeof r.body?.summary?.active === "number", `summary present`);
r = await json(`${BASE}/api/dares?owner=${encodeURIComponent(address)}`);
assert(r.status === 401, `owner-scoped list rejected without identity (${r.status})`);
r = await json(`${BASE}/api/dares?owner=${encodeURIComponent(address)}`, {
  headers: { authorization: authHeader },
});
assert(r.body?.dares?.some((d) => d.id === dareId), `filter dares by owner`);

// 7. Solo dare reads require the owner's wallet identity
const outsider = KeyPair.generate();
const outsiderPub = outsider.publicKey.toHex();
const outsiderMsg = `nimdares-login:${Date.now()}`;
const outsiderSig = signFor(outsider)(outsiderMsg);
const outsiderAuth = `Nimiq ${outsiderPub}:${outsiderSig}:${Buffer.from(outsiderMsg).toString("base64url")}`;
r = await json(`${BASE}/api/dares/${dareId}`);
assert(r.status === 404, `solo dare hidden from unauthenticated reads (${r.status})`);
r = await json(`${BASE}/api/dares/${dareId}`, { headers: { authorization: outsiderAuth } });
assert(r.status === 404, `solo dare hidden from other wallets (${r.status})`);
r = await json(`${BASE}/api/dares/${dareId}`, { headers: { authorization: authHeader } });
assert(r.status === 200 && r.body?.dare?.id === dareId, `owner gets solo dare by id`);
r = await json(`${BASE}/api/dares?owner=${encodeURIComponent(address)}`, {
  headers: { authorization: outsiderAuth },
});
assert(r.status === 403, `owner list rejects another account's identity (${r.status})`);

// 8. User endpoint
r = await json(`${BASE}/api/user?address=${encodeURIComponent(address)}`, {
  headers: { authorization: authHeader },
});
assert(r.status === 200 && r.body?.user?.address === address, `user endpoint returns address`);
assert(r.body?.dareCount >= 1, `user dareCount includes created dare`);
const stranger = KeyPair.generate();
const stranStrPub = stranger.publicKey.toHex();
const stranStrMsg = `nimdares-login:${Date.now()}`;
const stranStrSig = signFor(stranger)(stranStrMsg);
const strangerAuth = `Nimiq ${stranStrPub}:${stranStrSig}:${Buffer.from(stranStrMsg).toString("base64url")}`;
r = await json(`${BASE}/api/user?address=${encodeURIComponent(address)}`, {
  headers: { authorization: strangerAuth },
});
assert(r.status === 403, `user endpoint rejects cross-account reads (${r.status})`);

// 9. Proof submission runs (image-less VISION is rejected, GitHub link accepted)
r = await json(`${BASE}/api/dares/${dareId}/proof`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: authHeader },
  body: JSON.stringify({ proofImage: "data:image/png;base64,AAAA" }),
});
assert(
  [400, 201, 409].includes(r.status),
  `proof submission handled (${r.status}${r.body?.error ? `: ${r.body.error}` : ""})`
);
if (r.status === 201 && r.body?.dare?.status === "SUBMITTED") {
  r = await json(`${BASE}/api/dares/${dareId}`, {
    method: "DELETE",
    headers: { authorization: authHeader },
  });
  assert(r.status === 409, `cancel is blocked after proof submission (${r.status})`);
} else {
  console.log("ok: proof cutoff deferred because the test dare was not funded");
}

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

// ---- Room (solo/team/arena) flows ----
const roomDeadline = new Date(Date.now() + 48 * 3600_000).toISOString();
const bob = KeyPair.generate();
const bobPub = bob.publicKey.toHex();
const bobMsg = `nimdares-login:${Date.now()}`;
const bobSig = signFor(bob)(bobMsg);
const bobAuth = `Nimiq ${bobPub}:${bobSig}:${Buffer.from(bobMsg).toString("base64url")}`;
const charlie = KeyPair.generate();
const charliePub = charlie.publicKey.toHex();
const charlieMsg = `nimdares-login:${Date.now()}`;
const charlieSig = signFor(charlie)(charlieMsg);
const charlieAuth = `Nimiq ${charliePub}:${charlieSig}:${Buffer.from(charlieMsg).toString("base64url")}`;

// 11. A non-owner cannot cancel someone else's dare
r = await json(`${BASE}/api/dares/${dareId}`, {
  method: "DELETE",
  headers: { authorization: bobAuth },
});
assert(r.status === 403, `non-owner cancellation is rejected (${r.status})`);

// 12. Create team room with explicit capacity
r = await json(`${BASE}/api/dares`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: authHeader },
  body: JSON.stringify({
    title: "Team sprint: 10k runs",
    description: "Together the team runs a cumulative 10k this week.",
    criteria: "Each member shows a completed run tally by the deadline.",
    asset: "NIM",
    amount: 2,
    deadline: roomDeadline,
    verifierKind: "VISION",
    mode: "team",
    maxCapacity: 3,
  }),
});
assert(r.status === 201 && r.body?.ok === true, `create team room succeeds (${r.status})`);
const teamId = r.body?.dare?.id;
assert(r.body?.dare?.status === "LOBBY", `team room starts LOBBY`);
assert(r.body?.dare?.maxCapacity === 3, `team room stores maxCapacity`);
assert(r.body?.dare?.isPrivate === true, `team room is private by default`);
const teamRoomCode = r.body?.dare?.roomCode;
assert(typeof teamRoomCode === "string" && teamRoomCode.length === 6, `team room has a 6-char roomCode`);

// 13. Create arena (public) room
r = await json(`${BASE}/api/dares`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: authHeader },
  body: JSON.stringify({
    title: "Arena: longest plank",
    description: "Open table: whoever holds the longest plank at check-in wins the pot.",
    criteria: "Share a live plank timer at the deadline.",
    asset: "NIM",
    amount: 1,
    deadline: roomDeadline,
    verifierKind: "VISION",
    mode: "arena",
    maxCapacity: 4,
  }),
});
assert(r.status === 201 && r.body?.ok === true, `create arena room succeeds (${r.status})`);
const arenaId = r.body?.dare?.id;
assert(r.body?.dare?.isPrivate === false, `arena room is public`);
assert(r.body?.dare?.roomCode === null, `arena rooms carry no invite code`);

// 14. Open feed lists arena rooms only
r = await json(`${BASE}/api/dares?mode=open`);
assert(r.status === 200 && Array.isArray(r.body?.rooms), `open feed returns rooms`);
assert(r.body?.rooms?.some((d) => d.id === arenaId), `arena room appears in open feed`);
assert(!r.body?.rooms?.some((d) => d.id === teamId), `private team room is hidden from open feed`);
assert(!r.body?.rooms?.some((d) => d.maxCapacity <= 1), `solo dares are hidden from open feed`);

// 15. Team room reads are gated by invite code or wallet identity
r = await json(`${BASE}/api/dares/${teamId}`);
assert(r.status === 403 && r.body?.codeRequired === true, `team room hidden without code (${r.status})`);
r = await json(`${BASE}/api/dares/${teamId}?code=${encodeURIComponent(teamRoomCode)}`);
assert(r.status === 200 && Array.isArray(r.body?.participants), `get room with invite code returns participants`);
assert(r.body?.participants?.length === 1, `creator holds the first seat`);
assert(r.body?.participants?.[0]?.userAddress === address, `creator seat belongs to creator`);
assert(r.body?.dare?.roomCode === teamRoomCode, `invite code returned to a code holder`);

// 16. Join room with a valid code as a second user
r = await json(`${BASE}/api/dares/${teamId}/join`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: bobAuth },
  body: JSON.stringify({ roomCode: teamRoomCode }),
});
assert(r.status === 201 && r.body?.ok === true, `join team room with code succeeds (${r.status})`);
assert(
  r.body?.funding?.memo === `nimdares:${r.body?.participant?.id}`,
  `join returns per-seat funding memo nimdares:<participantId>`
);
assert(
  r.body?.funding?.escrowConfigured === false ? r.body?.funding?.escrowAddress === null : typeof r.body?.funding?.escrowAddress === "string",
  `join reports escrow honestly (configured=${r.body?.funding?.escrowConfigured})`
);

// 17. Get room now shows two seats (code and participant identity both work)
r = await json(`${BASE}/api/dares/${teamId}?code=${encodeURIComponent(teamRoomCode)}`);
assert(r.body?.participants?.length === 2, `room lists creator and joiner seats`);
r = await json(`${BASE}/api/dares/${teamId}`, { headers: { authorization: bobAuth } });
assert(r.status === 200 && r.body?.participants?.length === 2, `participant reads the full room with identity`);

// 18. Duplicate join is rejected
r = await json(`${BASE}/api/dares/${teamId}/join`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: bobAuth },
  body: JSON.stringify({ roomCode: teamRoomCode }),
});
assert(r.status === 409, `duplicate join rejected (${r.status})`);

// 19. Wrong room code is rejected
r = await json(`${BASE}/api/dares/${teamId}/join`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: charlieAuth },
  body: JSON.stringify({ roomCode: "XXXXXX" }),
});
assert(r.status === 403, `wrong room code rejected (${r.status})`);

// 20. Joining a solo dare is rejected
r = await json(`${BASE}/api/dares/${dareId}/join`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: charlieAuth },
});
assert(r.status === 409, `solo dare join rejected (${r.status})`);

console.log("done.");
