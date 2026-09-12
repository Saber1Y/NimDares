---
name: nimdares-brief
description: Comprehensive project brief, architecture, tech stack, and conventions for NimDares (Nimiq Pay AI goal-staking mini app). Use this when starting work on NimDares or when the partner's agent needs context on the codebase, API routes, Nimiq/EVM escrow, verifiers, and UI design system.
---

# NimDares Project Brief & Architecture

## Overview
NimDares is a decentralized commitment escrow mini-app built for **Nimiq Pay** (Cycle 3 Competition). Users stake NIM or USDT on personal commitments ("dares"), submit verifiable proof (Vision AI screenshots, GitHub PRs, or Strava activities), and the escrow automatically resolves—paying out winners or sweeping failed stakes into the slash pool.

---

## Tech Stack & Architecture
- **Framework:** Next.js 16 (App Router), TypeScript, Tailwind v4.
- **UI & Motion:** Motion (`motion/react`), Lucide icons, command-center console aesthetics (dark canvas `#09090b`, lime accent `oklch(0.88 0.18 116)`, dot-grid backgrounds, HUD panels).
- **Data Layer:** Prisma 7 with PostgreSQL (`@prisma/adapter-pg` + `pg`) and an in-memory fallback ledger store (`src/lib/db.ts`).
- **Nimiq Web3:** `@nimiq/core` (Node.js build) for server-side address derivation, verification, and basic transaction building; `@nimiq/mini-app-sdk` for client wallet connection, signing (`provider.sign`), and staking (`provider.sendBasicTransaction`).
- **EVM Integration:** Ethers v6 for Polygon mainnet/Amoy testnet USDT escrow and payouts.
- **AI & Verifiers:** Gemini 2.5 Flash via `@google/genai` for structured vision adjudication, GitHub commits/PRs, and Strava activity fetching (`src/lib/vision.ts`, `github.ts`, `strava.ts`).

---

## Directory Structure
- `src/app/`
  - `page.tsx` - Landing page with live escrow lifecycle terminal.
  - `app/page.tsx` - Operator dashboard (wallet HUD, metrics, dare ledger).
  - `app/create/` - Create dare form with Nimiq signature auth.
  - `app/dare/[id]/` - Dare detail page with live polling, proof submission, and in-app NIM funding.
  - `api/` - API routes for auth (`/api/auth/verify`), dares (`/api/dares`, `/api/dares/[id]`, `/api/dares/[id]/proof`), user profile (`/api/user`), reconciliation (`/api/wallet/reconcile`), and cron sweep (`/api/cron/sweep`).
- `src/lib/`
  - `db.ts` - `LedgerStore` abstracting Prisma Postgres and in-memory store.
  - `verify.ts` - Nimiq signature parsing and address derivation (`blake2b-256` first 20 bytes).
  - `escrow/` - NIM and USDT escrow logic and transaction builders.
  - `adjudicate.ts` - Verifier dispatch (VISION, GITHUB, STRAVA).
  - `payout.ts` - Escrow payout execution.
- `scripts/`
  - `e2e-api.mjs` - End-to-end API test suite.

---

## Key Development Conventions
1. **Port 3100:** Port 3000 is occupied by an unrelated local server. Run dev/start on port 3100 (`npx next dev -p 3100`).
2. **Git Workflow:** Push logical changes directly to `origin/main` (`git@github.com:Saber1Y/NimDares.git`). Never add agent co-author metadata or em dashes ("—").
3. **Environment & Secrets:** Missing environment keys (DATABASE_URL, GEMINI_API_KEY, escrow private keys) must fail gracefully with honest `UNAVAILABLE` or `DEV / SIMULATED` states—never fake success.
4. **Design Quality:** Follow the established command-center console look (dark tech, high-end typography, HUD panels, WCAG contrast, dual-mode / dark consistency).
