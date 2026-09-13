# NimDares

Decentralized, AI-adjudicated goal-staking platform for the Nimiq Pay Mini Apps Competition.

Stake on a commitment, prove it, get settled. NimDares runs a unified **3-Mode system**:

| Mode | maxCapacity | isPrivate | Description |
|---|---|---|---|
| **Solo** | 1 | true | Self-improvement: wallet vs. themselves. Zero-sum refund or charity route. |
| **Team** | > 1 | true | Private squad, shareable link, not in the public feed. Quitters fund the doers. |
| **Arena** | > 1 | false | Public colosseum listed on the feed; anyone joins until capacity. |

Every mode reuses the same escrow, adjudication, and settlement engine.

## Quick Start

### Prerequisites

- Node.js >= 20
- npm or pnpm
- (Optional) `GEMINI_API_KEY` for AI vision adjudication
- (Optional) Supabase Postgres for persistent storage (`DATABASE_URL`)

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
| `DATABASE_URL` | No | Supabase Postgres connection string. Without it, the app uses an in-memory store (dev mode). |
| `GEMINI_API_KEY` | No | Google Gemini API key for vision adjudication. |
| `ESCROW_NIM_KEY_HEX` | No | NIM escrow private key hex (64 chars). Needed for NIM payouts. |
| `ESCROW_EVM_KEY_HEX` | No | EVM/Polygon escrow private key hex. Needed for USDT payouts. |
| `CHARITY_WALLET` / `*_MAINNET` / `*_TESTNET` | No | NIM address receiving solo losers' stakes (per-network; mainnet default = Nimiq ImpactX Foundation). |
| `COMMUNITY_TREASURY` / `*_MAINNET` / `*_TESTNET` | No | NIM address receiving the pot when a room has zero winners (per-network). |
| `GITHUB_TOKEN` | No | GitHub PAT for API-based dare verification. |
| `STRAVA_ACCESS_TOKEN` | No | Strava API token for activity verification. |
| `CRON_SECRET` | No | Secret for protecting the sweep cron endpoint. |
| `NEXT_PUBLIC_NETWORK` | No | `amoy` (default) or `mainnet` for Polygon EVM. |
| `NIMIQ_NETWORK` | No | Nimiq network to track: `mainnet` (default) or `testnet`. |
| `NIM_RPC_URL` | No | NIM JSON-RPC endpoint (default: `rpc.nimiqwatch.com` mainnet / `rpc.testnet.nimiqwatch.com` testnet). |
| `NIM_NETWORK_ID` | No | Albatross network id override (default: `24` mainnet / `5` testnet). |
| `EVM_RPC_URL` | No | Polygon RPC endpoint. |

### Development

```bash
npm run dev
```

Open [http://localhost:3100](http://localhost:3100).

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
      page.tsx                   # Dashboard + Arena feed + user's dares
      create/page.tsx            # Create Solo / Team / Arena room
      dare/[id]/page.tsx         # Room lobby: countdown, participants, join, proof
      admin/page.tsx             # Admin view (escrow balances, tx history)
    api/
      auth/verify/               # Nimiq signature authentication
      user/                      # User profile + dares
      dares/                     # Create / list / join / proof submission
      wallet/reconcile/          # On-chain balance refresh + deposit attribution
      cron/sweep/                # Automated adjudication + settlement
      admin/                     # Admin data endpoint
  components/                    # Reusable UI (HudPanel, RoomCard, StatusPill, Button, etc.)
  lib/                           # Business logic, escrow, verifiers, auth, settlement
  generated/prisma/              # Generated Prisma client
```

## How It Works

1. **Connect** - User opens NimDares in Nimiq Pay. The SDK silently requests the wallet address.
2. **Commit and stake** - User enters the title, criteria, stake amount (NIM), deadline, verifier, and mode (Solo / Team / Arena), then approves the native Nimiq Pay payment sheet.
3. **Confirm** - The app verifies the broadcast deposit against the escrow and only then marks the dare or funded room seat active.
4. **Join** - Team rooms live behind a shareable link; Arena rooms are listed on the public feed until capacity is reached.
5. **Submit Proof** - Before the deadline, each participant uploads a screenshot (Vision) or links an API activity.
6. **Adjudicate** - After the deadline, the sweep cron runs Gemini vision / API verification.
7. **Settle** - Solo: winners refunded, losers go to the charity wallet. Team/Arena: winners keep their stake plus a split of the losers' pot (remainder to the slash pool).

## Verifier Types

- **VISION** - AI reads a screenshot against the acceptance criteria using Gemini 3.6 Flash.
- **GITHUB** - Checks public GitHub events API for activity since dare creation.
- **STRAVA** - Validates a Strava activity URL against the dare timeline.

## API Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/verify` | Verify Nimiq signature, create/return user |
| GET | `/api/dares` | List dares (optionally filtered by `?owner=`, `?mode=`, `?open=`) |
| POST | `/api/dares` | Create a new dare (Solo / Team / Arena) |
| POST | `/api/dares/[id]/fund` | Verify a native NIM payment and activate the dare or funded room seat |
| GET | `/api/dares/[id]` | Get a single dare with participants |
| POST | `/api/dares/[id]/join` | Join a room (capacity + roomCode gate) |
| POST | `/api/dares/[id]/proof` | Submit proof image or link for a seat |
| POST | `/api/wallet/reconcile` | Refresh on-chain escrow balance + credit funded seats |
| POST | `/api/cron/sweep` | Run adjudication and settlement sweep |
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
- **Backend**: Next.js API Routes, Prisma ORM, Supabase Postgres (or in-memory)
- **Wallet**: `@nimiq/mini-app-sdk` (NIM), ethers.js v6 (USDT on Polygon)
- **AI**: Google Gemini 3.6 Flash via `@google/genai`
- **Auth**: Ed25519 signature verification via `@noble/ed25519`

## Competition Entry

- **Platform**: Nimiq Pay Mini Apps Competition Cycle 3
- **License**: MIT

## License

MIT
