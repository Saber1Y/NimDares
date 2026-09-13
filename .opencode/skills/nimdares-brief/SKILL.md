---
name: nimdares-brief
description: Comprehensive project brief, architecture, tech stack, and conventions for NimDares (Nimiq Pay AI goal-staking mini app). Use this when starting work on NimDares or when the partner's agent needs context on the codebase, API routes, Nimiq/EVM escrow, verifiers, and UI design system.
---

# NimDares Project Brief & Architecture

## Overview
NimDares is a decentralized commitment escrow mini-app built for **Nimiq Pay** (Cycle 3 Competition). Users stake NIM on personal commitments ("dares"), submit verifiable proof (Vision AI screenshots, GitHub PRs, or Strava activities), and the escrow automatically resolves - paying out winners or sweeping failed stakes into the slash pool.

The platform runs a unified **3-Mode system** driven entirely by `maxCapacity` and `isPrivate`:
- **Mode A - Solo** (`maxCapacity: 1`, `isPrivate: true`): user stakes against themselves. No waiting for others.
- **Mode B - Team** (`maxCapacity: > 1`, `isPrivate: true`): private squad with a shareable link, not in the public feed. Friends join, quitters' stakes fund the doers.
- **Mode C - Arena** (`maxCapacity: > 1`, `isPrivate: false`): public colosseum listed on the feed; anyone joins until capacity is reached.

All three modes share one backend (create/join/verify/settle), one escrow model, and one settlement engine.

---

## Tech Stack & Architecture
- **Framework:** Next.js 16 (App Router), TypeScript, Tailwind v4.
- **UI & Motion:** Motion (`motion/react`), Lucide icons, command-center console aesthetics (dark canvas `#09090b`, lime accent `oklch(0.88 0.18 116)`, dot-grid backgrounds, HUD panels).
- **Data Layer:** Prisma 7 with PostgreSQL (**Supabase**, `@prisma/adapter-pg` + `pg`) for production; in-memory fallback ledger store (`src/lib/db.ts`) when `DATABASE_URL` is unset (dev/demo mode). Supabase works cleanly with Vercel.
- **Nimiq Web3:** `@nimiq/core` (Node.js build) for server-side address derivation, verification, and basic transaction building; `@nimiq/mini-app-sdk` for client wallet connection, signing (`provider.sign`), and staking (`provider.sendBasicTransaction` / `sendBasicTransactionWithData`).
- **EVM Integration:** Ethers v6 for Polygon USDT escrow and payouts (deferred for rooms in the first cut; NIM first).
- **AI & Verifiers:** Gemini 3.6 Flash via `@google/genai` for structured vision adjudication (override model via `GEMINI_MODEL`; default `gemini-3.6-flash`, older `gemini-2.5-flash` is retired for new users). GitHub commits/PRs and Strava fetch remain deployed verifiers (`src/lib/vision.ts`, `github.ts`, `strava.ts`) but are solo-only for the rooms cut.
- **Auth:** Nimiq Ed25519 signature verification (`@noble/ed25519`) over `sha256(message)`; header `Nimiq <pubHex>:<sigHex>:<base64url(msg)>`.

---

## Directory Structure
- `src/app/`
  - `page.tsx` - Landing page with live escrow lifecycle terminal.
  - `app/page.tsx` - Operator dashboard + Arena feed (public rooms) + user's dares.
  - `app/create/` - Create dare form (Solo / Team / Arena modes) with Nimiq signature auth.
  - `app/dare/[id]/` - Dare detail + room lobby (participant list, countdown, join), proof submission, in-app NIM funding.
  - `api/` - API routes for auth (`/api/auth/verify`), dares (`/api/dares`, `/api/dares/[id]`, `/api/dares/[id]/join`, `/api/dares/[id]/proof`), user profile (`/api/user`), reconciliation (`/api/wallet/reconcile`), and cron sweep (`/api/cron/sweep`).
- `src/components/`
  - `nimiq-provider.tsx` - `@nimiq/mini-app-sdk` context wrapper.
  - `room-card.tsx` - Room card for the Arena feed.
  - `pill-nav.tsx` / `app-nav.tsx` - top navigation (no fake network toggle; testnet lives in the Nimiq Pay dev menu).
- `src/lib/`
  - `db.ts` - `LedgerStore` abstracting Prisma Postgres (Supabase) and in-memory store; room + participant operations.
  - `verify.ts` - Nimiq signature parsing and address derivation (`blake2b-256` first 20 bytes).
  - `escrow/` - NIM and USDT escrow logic and transaction builders.
  - `adjudicate.ts` - Verifier dispatch (VISION, GITHUB, STRAVA).
  - `payout.ts` - Escrow payout execution (single + room settlement math).
- `scripts/`
  - `e2e-api.mjs` - End-to-end API test suite (create, join, fund, settle math).
  - `e2e-adjudicate.mjs` - Vision adjudication E2E with a real Gemini key.

---

## Data Model (Prisma)
- `Dare` = a room. Extended with `maxCapacity Int`, `isPrivate Boolean`, `roomCode String?`, `participants Participant[]`. Statuses: `PENDING_FUNDING` (solo) / `LOBBY` (rooms) / `ACTIVE` / `SUBMITTED` / `SETTLED` (rooms) / `WON` / `LOST` / `SWEEPING`.
- `Participant` = one seat in a room: `dareId`, `userAddress`, `stakeRaw BigInt`, `fundingTxHash?`, `fundedAt?`, `proofImageUrl?`, `aiVerdict VerifierState`, `verdictReason?`, `payoutAmountRaw BigInt`, `payoutTxHash?`, `payoutStatus?`.
- Money is **always `BigInt` raw units** (NIM = Luna, USDT = micro USDT). Never `Float` for ledgers.
- `User`, `TxRecord` (ledger of ESCROW_DEPOSIT / SWEEP / SLASH_POOL / PAYOUT), `EscrowBalance` remain unchanged.

---

## Settlement Math
Runs on room deadline expiry (`/api/cron/sweep`). Splits are floored; remainder stays in the slash pool so the pot balances.

### Solo (`maxCapacity === 1`)
- VALID: refund `stakeRaw` to the owner (zero sum).
- INVALID: send `stakeRaw` to `CHARITY_WALLET`.

### Team / Arena (`maxCapacity > 1`)
- Filter participants into winners (`aiVerdict: VALID`) and losers (`INVALID` or `WAITING`).
- If no winners: send entire pot to `COMMUNITY_TREASURY`.
- If winners exist: `bonusRaw = floor(losersRaw / winners.length)`; each winner gets `stakeRaw + bonusRaw`.
- Mark room `SETTLED`.

### Deposit attribution
Each participant pays their seat via `sendBasicTransactionWithData` with `data: "nimdares:<dareId>:<participantId>"` to the escrow address. `/api/wallet/reconcile` scans NIM RPC, parses the memo, credits the seat, and marks the room `ACTIVE`. Attribution is reconciliation-based only - never trust a client-claimed tx hash.

---

## Key Development Conventions
1. **Port 3100:** Port 3000 is occupied by an unrelated local server. Run dev/start on port 3100 (`npx next dev -p 3100`).
2. **Git Workflow:** Push logical changes directly to `origin/main` (`git@github.com:Saber1Y/NimDares.git`). Never add agent co-author metadata or em dashes ("—").
3. **Environment & Secrets:** Missing environment keys (`GEMINI_API_KEY`, escrow private keys, `CHARITY_WALLET`, `COMMUNITY_TREASURY`) must fail gracefully with honest `UNAVAILABLE` / `DEV / SIMULATED` states - never fake success.
4. **Design Quality:** Follow the established command-center console look (dark tech, high-end typography, HUD panels, WCAG contrast, dual-mode / dark consistency).
5. **Competition scope:** The Cycle 3 submission ships Solo as the guaranteed, fully-tested path and Team/Arena on the same escrow - rooms are NIM-first, VISION verifier. Real payouts require escrow keys; without them statuses read `PENDING` / `unconfigured`.

---

## Roadmap (post-competition)
- USDT (USDT rooms via Polygon, string per EVM tokens reference).
- Per-member GITHUB / STRAVA adjudication inside rooms.
- Global + group leaderboards, head-to-head mode, invite/viral loop via Nimiq Pay deep links.
- **Guiding principle from product discussion:** group participation should make dares *more* fun and social, never more complex to adjudicate than the single-user flow.