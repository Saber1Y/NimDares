import { Address, KeyPair, PrivateKey, TransactionBuilder } from "@nimiq/core";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const API = process.env.E2E_API ?? "https://nimdares.vercel.app";
const RPC = "https://rpc.nimiqwatch.com";
const NETWORK_ID = 24;
const FEE_LUNA = 100n;
const EXPECTED_ESCROW = "NQ937600V1VEK63JUQY46BS34M32YAM0GQHD";
const STATE = "/tmp/nimdares-e2e-mainnet.json";

const mode = process.argv[2];
const log = (k: string, v: unknown) =>
  console.log(`[${new Date().toISOString()}] ${k}:`, typeof v === "string" ? v : JSON.stringify(v));

function nimRpc<T>(method: string, params: unknown[]): Promise<T> {
  return fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  }).then(async (res) => {
    if (!res.ok) throw new Error(`rpc ${method} ${res.status}`);
    const payload = (await res.json()) as {
      result?: { data?: T; metadata?: unknown } | T;
      error?: { message?: string };
    };
    if (payload.error) throw new Error(payload.error.message);
    const r = payload.result;
    if (r && typeof r === "object" && "data" in r) return (r as { data: T }).data;
    return r as T;
  });
}

async function blockHeight(): Promise<number> {
  try { return await nimRpc<number>("getBlockNumber", []); }
  catch { return await nimRpc<number>("blockNumber", []); }
}

async function getBalance(address: string): Promise<bigint> {
  const account = await nimRpc<{ balance: number | string }>(
    "getAccountByAddress",
    [address.replace(/\s+/g, "")],
  ).catch(() => ({ balance: "0" }));
  const raw = String(account.balance ?? "0");
  return BigInt(raw.length ? raw : "0");
}

async function waitForTx(hash: string, timeoutMs = 60_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tx = await nimRpc<unknown>("getTransactionByHash", [hash]).catch(() => null);
    if (tx) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

async function broadcast(fromKp: KeyPair, toAddress: string, valueLuna: bigint, data?: Uint8Array): Promise<string> {
  const height = await blockHeight();
  const tx = data
    ? TransactionBuilder.newBasicWithData(fromKp.toAddress(), Address.fromUserFriendlyAddress(toAddress), data, valueLuna, FEE_LUNA, height, NETWORK_ID)
    : TransactionBuilder.newBasic(fromKp.toAddress(), Address.fromUserFriendlyAddress(toAddress), valueLuna, FEE_LUNA, height, NETWORK_ID);
  tx.sign(fromKp, undefined);
  const hex = Buffer.from(tx.serialize()).toString("hex");
  await nimRpc<string>("sendRawTransaction", [hex]);
  return tx.hash();
}

function nimiqDigest(message: string): Uint8Array {
  const data = `\x16Nimiq Signed Message:\n${message.length}${message}`;
  return createHash("sha256").update(data, "utf8").digest();
}

function buildAuth(kp: KeyPair, message: string): string {
  const sig = kp.sign(nimiqDigest(message));
  return `Nimiq ${kp.publicKey.toHex()}:${sig.toHex()}:${Buffer.from(message, "utf8").toString("base64url")}`;
}

async function api<T>(path: string, kp: KeyPair, init: RequestInit = {}): Promise<T> {
  const message = `nimdares:e2e:${Date.now()}`;
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: buildAuth(kp, message),
      ...(init.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => null)) as T & { ok?: boolean; error?: string };
  if (res.status >= 400) {
    throw new Error(`api ${res.status} ${path}: ${(body as { error?: string })?.error ?? "unknown"}`);
  }
  return body;
}

function escrowKp(): { key: KeyPair; address: string } {
  const seed = process.env.ESCROW_NIM_KEY_HEX!;
  const key = seed.length === 128 ? KeyPair.fromHex(seed) : KeyPair.derive(PrivateKey.fromHex(seed));
  const address = key.toAddress().toUserFriendlyAddress();
  if (address.replace(/\s+/g, "") !== EXPECTED_ESCROW) {
    throw new Error(`escrow key mismatch: derived ${address}, expected ${EXPECTED_ESCROW}`);
  }
  return { key, address };
}

interface State {
  userSeed: string;
  userAddress: string;
  seedHash?: string;
  dareId?: string;
  fundHash?: string;
  createdAt?: string;
}

function loadState(): State | null {
  try {
    return JSON.parse(readFileSync(STATE, "utf8")) as State;
  } catch {
    return null;
  }
}

function saveState(s: State) {
  writeFileSync(STATE, JSON.stringify(s, null, 2));
  log("state saved", STATE);
}

// ─── SETUP: create dare + fund via escrow self-memo (no user balance needed) ─
async function setupPhase() {
  const escrow = escrowKp();
  const escrowAddr = escrow.address;
  const escrowCompact = escrowAddr.replace(/\s+/g, "");
  log("escrow", escrowAddr);
  log("escrow balance (mainnet)", Number(await getBalance(escrowCompact)) / 100_000 + " NIM");

  // Reuse an already-funded test user from state, else mint a fresh one.
  const existing = loadState();
  let user: KeyPair;
  let userAddress: string;
  let state: State;
  if (existing?.userSeed && existing.userAddress) {
    user = KeyPair.fromHex(existing.userSeed);
    userAddress = existing.userAddress;
    state = existing;
    log("resuming existing test user", userAddress);
  } else {
    // Persist user key BEFORE any network call
    user = KeyPair.generate();
    userAddress = user.toAddress().toUserFriendlyAddress();
    state = { userSeed: user.toHex(), userAddress };
    saveState(state);
    log("test user", userAddress);
  }

  // 1. Seed the test user from escrow only if it has no usable balance.
  //    Persisted first, so a crash can always restore the funds.
  let userBal = await getBalance(userAddress);
  if (userBal < 105_000n) {
    const seedRaw = 110_000n; // 1.1 NIM: 1 NIM stake + funding fee + sweep buffer
    log("seeding", Number(seedRaw) / 100_000 + " NIM escrow -> user");
    const seedHash = await broadcast(escrow.key, userAddress, seedRaw);
    state.seedHash = seedHash;
    saveState(state);
    log("seed tx", seedHash);
    if (!(await waitForTx(seedHash))) throw new Error("seed tx not confirmed on-chain");
    for (let i = 0; i < 10 && userBal < seedRaw - FEE_LUNA; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      userBal = await getBalance(userAddress);
    }
    log("user funded", Number(userBal) / 100_000 + " NIM");
    log("escrow now", Number(await getBalance(escrowCompact)) / 100_000 + " NIM");
  } else {
    log("user already funded", Number(userBal) / 100_000 + " NIM (skipping seed)");
  }

  // 2. Create solo GITHUB dare (deterministic VALID; no AI-judge gamble)
  const deadline = new Date(Date.now() + 15 * 60_000).toISOString();
  const create = await api<{ dare: { id: string; ownerAddress: string; status: string; createdAt: string; amount: number }; escrow: { address: string }; store: string }>("/api/dares", user, {
    method: "POST",
    body: JSON.stringify({
      title: "E2E mainnet: commit to the NimDares repo",
      description: "Automated end-to-end test of the real mainnet pipeline: create, fund, prove, pay out.",
      criteria: "Prove you committed to the Saber1Y/NimDares GitHub repository after the dare started.",
      asset: "NIM",
      amount: 1,
      deadline,
      verifierKind: "GITHUB",
      verifierLink: "Saber1Y",
      mode: "solo",
    }),
  });
  const dareId = create.dare.id;
  state.dareId = dareId;
  state.createdAt = create.dare.createdAt;
  saveState(state);
  log("dare created", { id: dareId, status: create.dare.status, createdAt: create.dare.createdAt, store: create.store, escrow: create.escrow.address });
  log("dare deadline", deadline);

  // 3. Fund: user -> escrow with memo nimdares:<dareId> (exact stake, real mainnet tx)
  const stakeRaw = BigInt(Math.round(create.dare.amount * 100_000));
  const memo = new TextEncoder().encode(`nimdares:${dareId}`);
  log("funding dare", `${Number(stakeRaw) / 100_000} NIM user -> escrow with memo nimdares:${dareId}`);
  const fundHash = await broadcast(user, escrowAddr, stakeRaw, memo);
  state.fundHash = fundHash;
  saveState(state);
  log("fund tx", fundHash);
  if (!(await waitForTx(fundHash))) throw new Error("fund tx not confirmed on-chain");

  // 3. Confirm funding via API (confirmNimFunding picks up the memo'd tx)
  const fund = await api<{ ok: boolean; status: string; txHash?: string }>(`/api/dares/${dareId}/fund`, user, {
    method: "POST",
    body: JSON.stringify({ asset: "NIM", txRef: fundHash }),
  });
  log("fund confirm", fund.status + (fund.txHash ? " tx=" + fund.txHash : ""));

  console.log("\n== NEXT STEP ==");
  console.log("Push a fresh commit to Saber1Y/NimDares (author date must be after " + create.dare.createdAt + "), then run:");
  console.log('E2E_COMMIT_URL="https://github.com/Saber1Y/NimDares/commit/<sha>" npm run e2e-mainnet -- verify');
}

// ─── VERIFY: submit proof + sweep back ───────────────────────────────────────
async function verifyPhase() {
  const commitUrl = process.env.E2E_COMMIT_URL;
  if (!commitUrl) throw new Error("E2E_COMMIT_URL required (the fresh commit URL submitted as proof)");
  const state = loadState();
  if (!state) throw new Error("No state file. Run setup first.");
  const user = KeyPair.fromHex(state.userSeed);
  const escrow = escrowKp();

  log("resuming", { user: state.userAddress, dare: state.dareId });

  // 4. Submit commit as proof -> deterministic VALID -> immediate payout
  log("submitting proof", commitUrl);
  const proof = await api<{
    ok: boolean;
    verdict: string;
    reason?: string;
    confidence?: number;
    payout: { status: string; txHash?: string; reason?: string } | null;
    dare: { status: string; payoutStatus: string | null; payoutTxHash: string | null; verifierResult: unknown } | null;
  }>(`/api/dares/${state.dareId}/proof`, user, {
    method: "POST",
    body: JSON.stringify({ proofLink: commitUrl }),
  });
  log("verdict", proof.verdict + (proof.reason ? " - " + proof.reason : ""));
  log("payout", proof.payout ? JSON.stringify(proof.payout) : "none");
  if (proof.dare) {
    log("dare after", { status: proof.dare.status, payoutStatus: proof.dare.payoutStatus, payoutTxHash: proof.dare.payoutTxHash });
    log("verifierResult", JSON.stringify(proof.dare.verifierResult));
  }

  // 5. Sweep test user balance back to escrow (restores escrow net)
  await new Promise((r) => setTimeout(r, 4000));
  const leftover = await getBalance(state.userAddress);
  log("test user balance", Number(leftover) / 100_000 + " NIM");
  if (leftover > FEE_LUNA) {
    const returnValue = leftover - FEE_LUNA;
    log("returning", Number(returnValue) / 100_000 + " NIM test user -> escrow");
    const retHash = await broadcast(user, escrow.address, returnValue);
    log("return tx", retHash);
    await waitForTx(retHash);
  } else {
    log("user leftover below fee; nothing to return", Number(leftover) / 100_000 + " NIM");
  }

  log("escrow balance final (mainnet)", Number(await getBalance(escrow.address.replace(/\s+/g, ""))) / 100_000 + " NIM");
  log("test user (reference)", state.userAddress);
}

// ─── RESTORE: sweep any leftover from test user back to escrow ───────────────
async function restorePhase() {
  const state = loadState();
  if (!state) throw new Error("No state file.");
  const user = KeyPair.fromHex(state.userSeed);
  const escrow = escrowKp();

  const leftover = await getBalance(state.userAddress);
  log("test user balance", Number(leftover) / 100_000 + " NIM");
  if (leftover > FEE_LUNA) {
    const returnValue = leftover - FEE_LUNA;
    log("returning", Number(returnValue) / 100_000 + " NIM test user -> escrow");
    const retHash = await broadcast(user, escrow.address, returnValue);
    log("return tx", retHash);
    await waitForTx(retHash);
  }
  log("escrow balance final (mainnet)", Number(await getBalance(escrow.address.replace(/\s+/g, ""))) / 100_000 + " NIM");
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  if (mode === "setup") return setupPhase();
  if (mode === "verify") return verifyPhase();
  if (mode === "restore") return restorePhase();
  console.log("usage: e2e-mainnet setup | verify | restore");
  process.exit(1);
}

main().then(
  () => process.exit(0),
  async (e) => {
    console.error("FAILED:", e);
    // auto-restore: sweep anything the test user holds back to escrow
    const state = loadState();
    if (state) {
      try {
        log("auto-restore", "attempting to return test user funds to escrow");
        const user = KeyPair.fromHex(state.userSeed);
        const escrow = escrowKp();
        const bal = await getBalance(state.userAddress);
        if (bal > FEE_LUNA) {
          await broadcast(user, escrow.address, bal - FEE_LUNA);
          log("auto-restore", "returned funds to escrow");
        }
      } catch (err) {
        log("auto-restore FAILED", err);
      }
    }
    process.exit(1);
  },
);
