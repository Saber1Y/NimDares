# NimDares

Decentralized, AI-adjudicated goal-staking platform for the Nimiq Pay Mini Apps Competition.

Users stake NIM or USDT on personal commitments. An autonomous AI control plane (Gemini Vision) or deterministic API verifier (GitHub, Strava) verifies proof-of-completion and automatically settles escrowed funds.

## Quick Start

### Prerequisites

- Node.js >= 20
- npm or pnpm
- (Optional) PostgreSQL for persistent storage
- (Optional) `GEMINI_API_KEY` for AI vision adjudication

### Setup

```bash
git clone https://github.com/Saber1Y/NimDares.git
cd NimDares
npm install
cp .env.example .env   # or create .env manually
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | No | PostgreSQL connection string. Without it, the app uses an in-memory store (dev mode). |
| `ESCROW_NIM_KEY_HEX` | No | NIM escrow private key hex (64 chars). Needed for NIM payouts. |
| `ESCROW_EVM_KEY_HEX` | No | EVM/Polygon escrow private key hex. Needed for USDT payouts. |
| `GEMINI_API_KEY` | No | Google Gemini API key for vision adjudication. |
| `GITHUB_TOKEN` | No | GitHub PAT for API-based dare verification. |
| `STRAVA_ACCESS_TOKEN` | No | Strava API token for activity verification. |
| `CRON_SECRET` | No | Secret for protecting the sweep cron endpoint. |
| `NEXT_PUBLIC_NETWORK` | No | `amoy` (default) or `mainnet` for Polygon EVM. |
| `NIM_RPC_URL` | No | NIM RPC endpoint (default: `rpc.nimiqwatch.com`). |
| `EVM_RPC_URL` | No | Polygon RPC endpoint. |

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Build & Production

```bash
npm run build
npm start
```

## Architecture

```
src/
  app/
    page.tsx                     # Landing page
    app/
      page.tsx                   # Dashboard (wallet HUD, dare ledger)
      create/page.tsx            # Create-a-dare flow
      dare/[id]/page.tsx         # Dare detail + proof submission
      admin/page.tsx             # Admin view (escrow balances, tx history)
    api/
      auth/verify/               # Nimiq signature authentication
      user/                      # User profile + dares
      dares/                     # CRUD + proof submission
      wallet/reconcile/          # On-chain balance refresh
      cron/sweep/                # Automated adjudication + payout
      admin/                     # Admin data endpoint
  components/                    # Reusable UI (HudPanel, StatusPill, Button, etc.)
  lib/                           # Business logic, escrow, verifiers, auth
  generated/prisma/              # Generated Prisma client
```

## How It Works

1. **Connect** - User opens NimDares in Nimiq Pay. The SDK silently requests the wallet address.
2. **Commit** - User creates a dare: title, criteria, stake amount (NIM or USDT), deadline, and verifier type.
3. **Fund** - User sends funds to the escrow address via the Nimiq Pay checkout sheet.
4. **Submit Proof** - Before the deadline, user uploads a screenshot (Vision) or links an API activity (GitHub/Strava).
5. **Adjudicate** - After the deadline, the sweep cron runs Gemini vision or API verification.
6. **Settle** - Winners get their stake back. Losers' funds go to the slash pool.

## Verifier Types

- **VISION** - AI reads a screenshot against the acceptance criteria using Gemini 3.6 Flash.
- **GITHUB** - Checks public GitHub events API for activity since dare creation.
- **STRAVA** - Validates a Strava activity URL against the dare timeline.

## API Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/verify` | Verify Nimiq signature, create/return user |
| GET | `/api/dares` | List dares (optionally filtered by `?owner=`) |
| POST | `/api/dares` | Create a new dare |
| GET | `/api/dares/[id]` | Get a single dare |
| POST | `/api/dares/[id]/proof` | Submit proof image or link |
| POST | `/api/wallet/reconcile` | Refresh on-chain escrow balance |
| POST | `/api/cron/sweep` | Run adjudication and payout sweep |
| GET | `/api/admin` | Admin view: escrow balances + tx history |

## Testing

```bash
# Run the full API E2E test (requires dev server running)
npm run test:e2e

# Run the vision adjudication E2E test (requires GEMINI_API_KEY)
npm run test:adjudicate
```

## Tech Stack

- **Frontend**: Next.js 16 (App Router), React 19, Tailwind CSS v4, Framer Motion
- **Backend**: Next.js API Routes, Prisma ORM, PostgreSQL (or in-memory)
- **Wallet**: `@nimiq/mini-app-sdk` (NIM), ethers.js v6 (USDT on Polygon)
- **AI**: Google Gemini 2.5 Flash via `@google/genai`
- **Auth**: Ed25519 signature verification via `@noble/ed25519`

## Competition Entry

- **Platform**: Nimiq Pay Mini Apps Competition Cycle 2
- **License**: MIT
- **Scoring**: 45 functionality / 25 Nimiq integration / 15 real usage / 10 design / 5 promo

## License

MIT
