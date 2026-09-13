# NimDares - Agent Build Brief

Decentralized goal-staking for the Nimiq Pay Mini Apps Competition.
A user stakes NIM or USDT on a personal commitment (a "dare").
An AI adjudicator (Gemini vision) or deterministic API verifier (GitHub, Strava) proves the outcome.
The escrow auto-settles: successful dare pays out the stake, failed dare sweeps it to the slash pool.

The platform uses a single **3-Mode system** driven by `maxCapacity` + `isPrivate`:
- Solo (`maxCapacity: 1`, private) - self-improvement, zero-sum refund or charity routing.
- Team (`maxCapacity: > 1`, private) - private squad via shareable link, not in the public feed.
- Arena (`maxCapacity: > 1`, public) - anyone joins until capacity; listed on the public feed.
All modes share one backend and one settlement engine.

Entry deadline: Cycle 3 (exact dates re-verify at miniappscompetition.com/rules; application opens ~Oct 2026).
Competition homepage: miniappscompetition.com.
Scoring: 45 functionality / 25 Nimiq integration / 15 real usage (25+ unique wallets) / 10 design / 5 promo.

This brief is the corrected, verified source of truth.
Trust the links in this file over general knowledge; the Nimiq mini-app ecosystem has breaking changes.

## Non-negotiables (competition rules)

- MIT license, public repo on GitHub, no hardcoded secrets, everything in `.env`.
- Must support NIM, USDT, or both. We do both.
- Fully functional first try. No prototype mode that hides flaws; every state honest.
- Nimiq integration must be real and visible: we sign message auth, pay stakes from the Pay provider, reconcile on-chain.

## Build order

1. Design tokens + command-center chrome (dot grid, pill nav, HUD panels).
2. Landing page at `/`.
3. App shell + dashboard at `/app` with the Arena feed.
4. Wallet connect + NimiqProvider context.
5. Create-a-dare flow (Solo / Team / Arena) with deposit (NIM or USDT).
6. API routes + Prisma models + escrow libs (NIM via `@nimiq/core` nodejs build, USDT via ethers v6).
7. AI/API verifiers (Gemini vision, GitHub, Strava).
8. Sweep/slash + payout + reconciliation + room settlement math.
9. Verification: typecheck, lint, build, E2E on Amoy devnet + browser fallback.

## Data persistence (Supabase + Prisma)

- Production database is **Supabase Postgres** (Vercel-friendly), wired through Prisma 7 (`DATABASE_URL`).
- `DATABASE_URL` set => Prisma store. Unset => in-memory store explicitly labeled DEV-MODE (dev/demo only, not for judging).
- Money is `BigInt` raw units (NIM = Luna, USDT = micro USDT). Never `Float` for ledgers.

## Verified API surface (do not drift from these)

### Nimiq Mini App SDK - `@nimiq/mini-app-sdk` v0.1.0

- `init()` waits for `window.nimiq`, returns a typed `NimiqProvider`. Call once at app start.
- `getHostLanguage()`, `getPrimaryColor()`, `getSecondaryColor()`.
- `listAccounts()` returns accounts with type `Basic` | `Vesting` that pay NIM.
- `sign(msg, msgType)` returns `{ publicKey, signature }`. Ed25519 over the msg bytes.
- `sendBasicTransaction(recipient, value, fee)` handles user->escrow NIM stake; values in Luna (1 NIM = 100,000 Luna).
- Deep link into the mini app: `nimiqpay://iapp?=<host>` or `https://nimpay.app/miniapps/open/<host>`.
- Reference: nimiq.dev/mini-apps/api-reference/nimiq-provider, npmjs.com/package/@nimiq/mini-app-sdk, github.com/nimiq/trust-web3-provider.

### USDT on Polygon - NOT the Nimiq provider

- Inside Nimiq Pay, USDT flows through the EIP-1193 `window.ethereum` bridge, not `window.nimiq`.
- Mainnet (what Pay ships): Polygon chainId 137, bridged USDT at `0xc2132D05D31c914a87C6611C10748AEb04B58e8F`.
- Dev/testnet: Polygon Amoy chainId 80002, "Mock USDT" faucet at `0x2Fd5885cC4bbbC06c883CA6673434ddDf4391943`.
- Pay users cannot be moved to testnet; `window.ethereum` may not exist when browsing outside Pay.
- Solution: one Network config abstraction with `usdtContract`, `rpcUrl`, `chainId`, `explorerUrl`, switched by env (`NEXT_PUBLIC_NETWORK=amoy|mainnet`).
- Ethers v6 `Contract` calls for balance/send. USDT is 6 decimals.
- Reference: nimiq.dev/mini-apps/api-reference/ethereum-provider, hints/features/evm-tokens.

### NIM escrow signing on the server - `@nimiq/core` v2.21.0 (nodejs entry)

Verified in Node 20, no browser globals needed:

```js
const { KeyPair, TransactionBuilder, Address, BufferUtils } = require('@nimiq/core'); // nodejs build
const kp = KeyPair.fromHex('<64 byte hex priv>');
const addr = kp.toAddress().toUserFriendlyAddress();
const tx = TransactionBuilder.newBasic(sender, recipient, value, fee, validityStartHeight, networkId);
tx.sign(kp);
const raw = tx.serialize(); // broadcast-friendly; BufferUtils.toHex for wire
```

- `networkId` for mainnet is 2.
- `tx.hash()` works offline; `tx.verify()` needs full account state (do not rely on it offline).
- `@nimiq/core-web` is browser-only (WASM via worker + `document`); we do NOT use it server-side.
- NIM is the natural currency: users deposit NIM in-app, escrow holds it, payouts are native NIM tx.
- Reference: npmjs.com/package/@nimiq/core.

### Auth

- Client: `nimiqProvider.sign(message, 'CustomMessage')` -> `{publicKey, signature}`; derive user address from publicKey server-side.
- Server: verify Ed25519 with `@noble/ed25519` (`verify`, `sha256`). Never trust the client's address on its own.

### Gemini vision adjudicator - `@google/genai` v2 (keep <3.0.0, Node >= 20)

- Use `gemini-3.6-flash` (default) or a newer Flash tier; older `gemini-2.5-flash` is retired for new users (404).
- Override via `GEMINI_MODEL` env var if needed.
- Vision proof flow: user uploads screenshot -> server routes to Gemini with the dare's exact criteria text.
- Require strict JSON output `{ status: "VALID"|"INVALID", reason }`; parse defensively.
- Cost-sensitive: run Fast model first, escalate to Pro only when confidence is low.
- Reference for correct package usage: ai.google.dev/gemini-api/docs and the npm package README.

### API verifiers (deterministic, no AI)

- GitHub merged PR: `GET /repos/{owner}/{repo}/pulls?state=closed` -> check `merged_at` + `user.login`.
- Strava activity: `GET /api/v3/athlete/activities` (Bearer token) -> match activity type + date.
- Both are token-gated; when token is missing, the status reads `UNAVAILABLE` (never fake success).

## Architecture

- Routes: `/` landing, `/app` dashboard (+ Arena feed), `/app/create` (Solo / Team / Arena),
  `/app/dare/[id]` (room lobby + countdown + participant list), `/app/dare/[id]/proof` (submit proof).
- API: `/api/auth/verify`, `/api/user` (me), `/api/dares` (GET list, POST create), `/api/dares/[id]`,
  `/api/dares/[id]/join` (join a room: capacity + roomCode gate, creates Participant), `/api/dares/[id]/proof`
  (vision + api verifiers per participant), `/api/wallet/reconcile`, `/api/cron/sweep`.
- Escrow model: hot wallet holds inflows; ledger tracks expected balances per dare; sweep NEVER pays more than expected balance.
- Slashing: lazy sweep on dashboard read + scheduled cron. Vercel Hobby cron is 1/day max.
- Reconciliation: query NIM RPC (`api.nimiq.com/v2/...`) and Polygon RPC for incoming deposits; mark dare funded when balance arrives.
- Deposit attribution: participants fund seats via `sendBasicTransactionWithData` with memo
  `nimdares:<dareId>:<participantId>`; reconcile parses the memo and credits the seat. Never trust client-claimed tx hashes.
- Settlement: `/api/cron/sweep` on deadline expiry. Solo = refund VALID / route INVALID to `CHARITY_WALLET`.
  Team/Arena = winners split `stake + floor(slashedPot / winners)`; zero winners => whole pot to `COMMUNITY_TREASURY`.
  Remainder stays in the slash pool. Mark room `SETTLED`.

## Design (command-center console)

- Skill: `/Users/mac/.agents/skills/command-center-console-ui/SKILL.md` (read it before UI work).
- Base canvas `#09090b`, dot grid `radial-gradient(... rgba(255,255,255,0.15) 1px ...)` at `32px`, `opacity-20`.
- Lime primary `oklch(0.88 0.18 116)`, glow `rgba(200,245,106,0.2)`.
- Floating pill nav, HUD panels (`rounded-2xl border bg-card/65 backdrop-blur-xl`), mono uppercase micro-labels.
- Honest status: `REAL / LIVE`, `PENDING`, `UNAVAILABLE`, `WAITING`, never fake success.
- Motion: `motion` package (framer-motion successor), staggered entrances, reduced-motion aware.

## Repo conventions

- Next.js 16 (breaking changes vs older docs; see `node_modules/next/dist/docs/`). Route handlers standard, `params` are Promises, typed `LayoutProps<'/x'>`.
- Tailwind v4, Turbopack dev. Package name `nimdares`. Commit + push per logical change to `gh remote origin` (github.com/Saber1Y/NimDares).
- Prisma for persistence (Postgres `DATABASE_URL` via Supabase). When unset, dev falls back to an in-memory store explicitly labeled DEV-MODE.
- Rooms are NIM-first for the first cut; USDT rooms deferred. VISION is the room verifier; GITHUB/STRAVA stay solo-only until room adjudication is proven.

## Prisma models

- User (address, publicKey, createdAt)
- Dare (= room; id, ownerAddress, title, description, criteria, asset NIM|USDT, amountRaw BigInt, deadline,
  status PENDING_FUNDING|LOBBY|ACTIVE|SUBMITTED|SETTLED|WON|LOST|SWEEPING, verifierKind VISION|GITHUB|STRAVA,
  maxCapacity Int, isPrivate Boolean, roomCode String?, proofImageUrl, verifierResult json, adjudicatedAt,
  payoutStatus PENDING|SETTLED|FAILED, payoutTxHash)
- Participant (= seat in a room; id, dareId, userAddress, stakeRaw BigInt, fundingTxHash, fundedAt, proofImageUrl,
  aiVerdict PENDING|VALID|INVALID|WAITING, verdictReason, payoutAmountRaw BigInt, payoutTxHash, payoutStatus)
- Transaction (hash, kind, asset, amount, status)
- EscrowBalance (address, asset, expectedBalance, updatedAt)

## Roadmap (post-competition)

### Rooms expansion

- USDT rooms (Polygon), per-member GITHUB / STRAVA adjudication inside rooms.
- Global + group leaderboards, head-to-head mode (loser's stake passes to winner), invite/viral loop via Nimiq Pay deep links.
- Principle from the product discussion: group participation should make dares more fun and social, never more complex to adjudicate than the single-user flow.