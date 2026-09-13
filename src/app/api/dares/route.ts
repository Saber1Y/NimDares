import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getStore } from "@/lib/db";
import { authenticate } from "@/lib/verify";
import { getNimEscrowInfo } from "@/lib/escrow/nim";
import { getEvmEscrowInfo } from "@/lib/escrow/evm";
import { NIM_DECIMALS } from "@/lib/config";
import { dareToClient, participantToClient, summaryToClient } from "@/lib/serialize";

const CreateDareSchema = z.object({
  title: z.string().min(3).max(80),
  description: z.string().min(10).max(2000),
  criteria: z.string().min(10).max(2000),
  asset: z.enum(["NIM", "USDT"]),
  amount: z.number().positive().max(1000),
  deadline: z.string().datetime(),
  verifierKind: z.enum(["VISION", "GITHUB", "STRAVA"]),
  verifierLink: z.string().min(3).max(160).optional(),
  mode: z.enum(["solo", "team", "arena"]).default("solo"),
  maxCapacity: z.number().int().min(2).max(50).optional(),
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
  const dares = (await store.listDares(owner)).map(dareToClient);
  let rooms: ReturnType<typeof dareToClient>[] = [];
  if (mode === "open") {
    rooms = (await store.listOpenRooms()).map((d) => {
      const client = dareToClient(d);
      return client;
    });
  }
  const summary = summaryToClient(await store.summary());
  return NextResponse.json({ ok: true, dares, rooms, summary, store: store.label });
}

export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = CreateDareSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid payload", issues: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { title, description, criteria, asset, amount, deadline, verifierKind, verifierLink, mode, maxCapacity } =
    parsed.data;

  const due = new Date(deadline);
  const maxDue = Date.now() + 90 * 86_400_000;
  if (due.getTime() <= Date.now() || due.getTime() > maxDue) {
    return NextResponse.json(
      { ok: false, error: "deadline must be in the future and within 90 days" },
      { status: 400 }
    );
  }

  const isMulti = mode === "team" || mode === "arena";
  const cap = isMulti ? maxCapacity ?? 5 : 1;
  const isPrivate = mode !== "arena";

  const amountRaw = asset === "NIM" ? BigInt(Math.round(amount * NIM_DECIMALS)) : BigInt(Math.round(amount * 1_000_000));

  const nimEscrow = getNimEscrowInfo();
  const evmEscrow = getEvmEscrowInfo();
  const escrowAddress = asset === "NIM" ? nimEscrow.address : evmEscrow.address;
  const escrowConfigured = asset === "NIM" ? nimEscrow.configured : evmEscrow.configured;

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
    roomCode: isMulti ? roomCode() : null,
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
      dare: dareToClient(dare),
      participants: participant ? [participantToClient(participant)] : [],
      escrow: {
        address: escrowAddress || null,
        configured: escrowConfigured,
        asset,
        amount,
      },
      store: store.label,
    },
    { status: 201 }
  );
}