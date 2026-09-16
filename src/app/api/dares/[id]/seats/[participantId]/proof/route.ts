import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/lib/db";
import { authenticate } from "@/lib/verify";
import { participantToClient } from "@/lib/serialize";
import { adjudicateDare } from "@/lib/adjudicate";
import {
  MAX_PROOF_ATTEMPTS,
  gateProofImage,
  hashProofImage,
} from "@/lib/proof-intake";

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

  if (!participant.fundedAt) {
    return NextResponse.json(
      { ok: false, error: "fund your seat before submitting proof" },
      { status: 409 }
    );
  }
  if (participant.aiVerdict === "VALID") {
    return NextResponse.json(
      { ok: false, error: "this seat has already been ruled valid" },
      { status: 409 }
    );
  }
  if (participant.proofAttempts >= MAX_PROOF_ATTEMPTS) {
    return NextResponse.json(
      { ok: false, error: `no proof attempts left (limit ${MAX_PROOF_ATTEMPTS})` },
      { status: 409 }
    );
  }

  if (proofImage) {
    const gate = await gateProofImage(proofImage, participant.proofAttempts, {
      participantId: participant.id,
    });
    if (!gate.ok) {
      return NextResponse.json({ ok: false, error: gate.error }, { status: gate.httpStatus ?? 400 });
    }
  }

  const attempts = participant.proofAttempts + 1;
  await store.updateParticipant(participantId, {
    proofImageUrl: proofImage ?? null,
    proofHash: proofImage ? hashProofImage(proofImage) : null,
    proofLink: proofLink ?? null,
    proofAttempts: attempts,
    aiVerdict: "WAITING",
    verdictReason: "queued for adjudication",
  });

  // Same as a solo dare: the seat is judged now so it can still be replaced.
  // The image lives on the seat, not the dare, so hand the adjudicator the
  // dare with the seat's proof attached - otherwise VISION finds no image.
  const verdict = await adjudicateDare({
    ...dare,
    proofImageUrl: proofImage ?? participant.proofImageUrl ?? null,
    proofLink: proofLink ?? null,
  });
  if (verdict.status === "UNAVAILABLE") {
    const held = await store.updateParticipant(participantId, {
      proofAttempts: participant.proofAttempts,
      verdictReason: verdict.reason,
    });
    return NextResponse.json({
      ok: true,
      verdict: "UNAVAILABLE",
      reason: verdict.reason,
      attemptsLeft: MAX_PROOF_ATTEMPTS - participant.proofAttempts,
      participant: participantToClient(held!),
      store: store.label,
    });
  }

  const ruled = await store.updateParticipant(participantId, {
    aiVerdict: verdict.status,
    verdictReason: verdict.reason,
    confidence: verdict.confidence ?? null,
  });
  return NextResponse.json({
    ok: true,
    verdict: verdict.status,
    reason: verdict.reason,
    confidence: verdict.confidence,
    observations: verdict.observations,
    attemptsLeft: verdict.status === "VALID" ? 0 : MAX_PROOF_ATTEMPTS - attempts,
    participant: participantToClient(ruled!),
    store: store.label,
  });
}