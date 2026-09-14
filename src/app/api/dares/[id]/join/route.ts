import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/lib/db";
import { authenticate } from "@/lib/verify";
import { getNimEscrowInfo } from "@/lib/escrow/nim";
import { getEvmEscrowInfo } from "@/lib/escrow/evm";
import { dareToClient, participantToClient } from "@/lib/serialize";

const JoinSchema = z.object({
  roomCode: z.string().min(4).max(12).optional(),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await authenticate(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { roomCode?: string } | null;
  const parsed = JoinSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "invalid payload" }, { status: 400 });
  }

  const store = getStore();
  const dare = await store.getDare(id);
  if (!dare) {
    return NextResponse.json({ ok: false, error: "dare not found" }, { status: 404 });
  }
  if (dare.maxCapacity <= 1) {
    return NextResponse.json({ ok: false, error: "solo dares cannot be joined" }, { status: 409 });
  }
  if (dare.status !== "LOBBY" && dare.status !== "ACTIVE") {
    return NextResponse.json(
      { ok: false, error: `room cannot be joined in state ${dare.status}` },
      { status: 409 }
    );
  }
  if (new Date(dare.deadline).getTime() <= Date.now()) {
    return NextResponse.json({ ok: false, error: "room join window has closed" }, { status: 409 });
  }
  if (dare.roomCode && parsed.data.roomCode && dare.roomCode !== parsed.data.roomCode) {
    return NextResponse.json({ ok: false, error: "invalid room code" }, { status: 403 });
  }

  const participants = await store.listParticipants(dare.id);
  if (participants.length >= dare.maxCapacity) {
    return NextResponse.json({ ok: false, error: "room is full" }, { status: 409 });
  }
  if (participants.some((p) => p.userAddress === auth.address)) {
    return NextResponse.json({ ok: false, error: "already a participant" }, { status: 409 });
  }

  const participant = await store.createParticipant({
    dareId: dare.id,
    userAddress: auth.address!,
    stakeRaw: dare.amountRaw,
  });

  const nimEscrow = getNimEscrowInfo();
  const evmEscrow = getEvmEscrowInfo();
  const escrowAddress = dare.asset === "NIM" ? nimEscrow.address : evmEscrow.address;
  const escrowConfigured = dare.asset === "NIM" ? nimEscrow.configured : evmEscrow.configured;

  return NextResponse.json(
    {
      ok: true,
      dare: dareToClient(dare),
      participant: participantToClient(participant),
      funding: {
        asset: dare.asset,
        amountLuna: dare.asset === "NIM" ? dare.amountRaw.toString() : null,
        escrowAddress: escrowAddress || null,
        escrowConfigured,
        memo: `nimdares:${participant.id}`,
      },
      store: store.label,
    },
    { status: 201 }
  );
}