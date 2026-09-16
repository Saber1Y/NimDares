import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getStore } from "@/lib/db";
import { authenticate } from "@/lib/verify";
import { getNimEscrowInfo } from "@/lib/escrow/nim";
import { generateEvidenceSpec } from "@/lib/evidence-spec";
import { getEvmEscrowInfo } from "@/lib/escrow/evm";
import { NIM_DECIMALS } from "@/lib/config";
import {
  dareToClient,
  participantToClient,
  summaryToClient,
} from "@/lib/serialize";

const CreateDareSchema = z.object({
  title: z
    .string({ error: "Title is required" })
    .min(3, "Title must be at least 3 characters")
    .max(80, "Title must be 80 characters or fewer"),
  description: z
    .string({ error: "Description is required" })
    .min(10, "Description must be at least 10 characters")
    .max(2000, "Description must be 2000 characters or fewer"),
  criteria: z
    .string({ error: "Acceptance criteria is required" })
    .min(10, "Criteria must be at least 10 characters")
    .max(2000, "Criteria must be 2000 characters or fewer"),
  asset: z.enum(["NIM", "USDT"], { error: "Asset must be NIM or USDT" }),
  amount: z
    .number({ error: "Amount must be a number" })
    .positive("Amount must be greater than zero")
    .max(1000, "Amount must be 1000 or less"),
  deadline: z
    .string({ error: "Deadline is required" })
    .datetime("Deadline must be a valid date and time"),
  verifierKind: z.enum(["VISION", "GITHUB", "STRAVA"], {
    error: "Verifier must be VISION, GITHUB, or STRAVA",
  }),
  verifierLink: z
    .string()
    .min(3, "Verifier link must be at least 3 characters")
    .max(160, "Verifier link must be 160 characters or fewer")
    .optional(),
  mode: z.enum(["solo", "team", "arena"], {
    error: "Mode must be solo, team, or arena",
  }).default("solo"),
  maxCapacity: z
    .number({ error: "Max capacity must be a number" })
    .int("Max capacity must be a whole number")
    .min(2, "Max capacity must be at least 2")
    .max(50, "Max capacity must be 50 or fewer")
    .optional(),
});

function roomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  let out = "";
  for (const b of bytes) out += chars[b % chars.length];
  return out;
}

export async function GET(req: NextRequest) {
  const owner = req.nextUrl.searchParams.get("owner") ?? undefined;
  const mode = req.nextUrl.searchParams.get("mode");
  const store = getStore();
  // An owner-scoped list is only safe for the wallet that owns it. Anyone
  // could otherwise enumerate another account's solo and private team dares.
  let dares: ReturnType<typeof dareToClient>[] = [];
  if (owner) {
    const auth = await authenticate(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
    }
    if (auth.address !== owner) {
      return NextResponse.json(
        { ok: false, error: "cannot list another account's dares" },
        { status: 403 },
      );
    }
    dares = (await store.listDares(owner)).map((d) => dareToClient(d));
  }
  let rooms: ReturnType<typeof dareToClient>[] = [];
  if (mode === "open") {
    rooms = (await store.listOpenRooms()).map((d) => dareToClient(d));
  }
  const summary = summaryToClient(await store.summary());
  return NextResponse.json({
    ok: true,
    dares,
    rooms,
    summary,
    store: store.label,
  });
}

export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = CreateDareSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    const firstMessage = Object.values(fieldErrors).find((msgs) => msgs?.length)?.[0] ?? "Invalid input";
    return NextResponse.json(
      { ok: false, error: firstMessage, issues: fieldErrors },
      { status: 400 },
    );
  }

  const {
    title,
    description,
    criteria,
    asset,
    amount,
    deadline,
    verifierKind,
    verifierLink,
    mode,
    maxCapacity,
  } = parsed.data;

  if (asset === "USDT") {
    return NextResponse.json(
      { ok: false, error: "NimDares on mainnet is NIM-only for now; USDT escrow is not available" },
      { status: 400 },
    );
  }

  const due = new Date(deadline);
  const maxDue = Date.now() + 90 * 86_400_000;
  if (due.getTime() <= Date.now() || due.getTime() > maxDue) {
    return NextResponse.json(
      { ok: false, error: "deadline must be in the future and within 90 days" },
      { status: 400 },
    );
  }

  const isMulti = mode === "team" || mode === "arena";
  const cap = isMulti ? (maxCapacity ?? 5) : 1;
  const isPrivate = mode !== "arena";

  // A room's seats are distinct GitHub users, so one bound username cannot
  // verify everyone's work.
  if (verifierKind === "GITHUB" && isMulti) {
    return NextResponse.json(
      { ok: false, error: "GitHub verification is available for solo dares only" },
      { status: 400 },
    );
  }

  const amountRaw =
    asset === "NIM"
      ? BigInt(Math.round(amount * NIM_DECIMALS))
      : BigInt(Math.round(amount * 1_000_000));

  const nimEscrow = getNimEscrowInfo();
  const evmEscrow = getEvmEscrowInfo();
  const escrowAddress = asset === "NIM" ? nimEscrow.address : evmEscrow.address;
  const escrowConfigured =
    asset === "NIM" ? nimEscrow.configured : evmEscrow.configured;

  // Fix the proof checklist before the stake is placed, so the rules are known
  // to the user up front and cannot drift once they know what they need to fake.
  const evidenceSpec =
    verifierKind === "VISION"
      ? await generateEvidenceSpec({ title, description, criteria, deadline: due })
      : null;

  const store = getStore();
  const dare = await store.createDare({
    ownerAddress: auth.address!,
    title,
    description,
    criteria,
    asset,
    amountRaw,
    deadline: due,
    verifierKind,
    verifierLink: verifierLink ?? null,
    maxCapacity: cap,
    isPrivate,
    roomCode: isMulti && isPrivate ? roomCode() : null,
    evidenceSpec,
  });

  let participant = null;
  if (isMulti) {
    participant = await store.createParticipant({
      dareId: dare.id,
      userAddress: auth.address!,
      stakeRaw: amountRaw,
    });
  }

  await store.recordTx({
    dareId: dare.id,
    userId: undefined,
    kind: "ESCROW_DEPOSIT",
    chain: asset === "NIM" ? "NIM" : "EVM",
    asset,
    amountRaw,
    fromAddress: auth.address!,
    toAddress: escrowAddress || null,
    status: "PENDING",
  });

  return NextResponse.json(
    {
      ok: true,
      dare: dareToClient(dare, { includeRoomCode: true }),
      participants: participant ? [participantToClient(participant)] : [],
      escrow: {
        address: escrowAddress || null,
        configured: escrowConfigured,
        asset,
        amount,
      },
      store: store.label,
    },
    { status: 201 },
  );
}
