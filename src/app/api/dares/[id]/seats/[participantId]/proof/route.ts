import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/lib/db";
import { authenticate } from "@/lib/verify";
import { participantToClient } from "@/lib/serialize";

const SeatProofSchema = z.object({
  proofImage: z.string().max(6_000_000).optional(),
  proofLink: z.string().min(3).max(160).optional(),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; participantId: string }> }
) {
  const auth = await authenticate(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  const { id, participantId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = SeatProofSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "invalid payload" }, { status: 400 });
  }
  const { proofImage, proofLink } = parsed.data;
  if (!proofImage && !proofLink) {
    return NextResponse.json({ ok: false, error: "provide proofImage or proofLink" }, { status: 400 });
  }

  const store = getStore();
  const participant = await store.getParticipant(participantId);
  if (!participant || participant.dareId !== id) {
    return NextResponse.json({ ok: false, error: "seat not found" }, { status: 404 });
  }
  if (participant.userAddress !== auth.address) {
    return NextResponse.json({ ok: false, error: "seat belongs to another identity" }, { status: 403 });
  }
  const dare = await store.getDare(id);
  if (!dare || (dare.status !== "LOBBY" && dare.status !== "ACTIVE")) {
    return NextResponse.json({ ok: false, error: "proofs are closed" }, { status: 409 });
  }
  if (new Date(dare.deadline).getTime() <= Date.now()) {
    return NextResponse.json({ ok: false, error: "deadline passed" }, { status: 409 });
  }

  const updated = await store.updateParticipant(participantId, {
    proofImageUrl: proofImage ?? null,
    proofLink: proofLink ?? null,
  });
  return NextResponse.json({
    ok: true,
    message: "seat proof stored",
    participant: participantToClient(updated!),
    store: store.label,
  });
}