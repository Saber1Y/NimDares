import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { authenticate } from "@/lib/verify";
import { dareToClient } from "@/lib/serialize";
import { adjudicateDare } from "@/lib/adjudicate";
import {
  MAX_PROOF_ATTEMPTS,
  canResubmit,
  gateProofImage,
  verdictToRecord,
} from "@/lib/proof-intake";
import { settleSoloWin } from "@/lib/settle";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function isDataUrl(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v)
  );
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await authenticate(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  const { id } = await ctx.params;
  const store = getStore();
  const dare = await store.getDare(id);
  if (!dare) {
    return NextResponse.json({ ok: false, error: "dare not found" }, { status: 404 });
  }
  if (dare.ownerAddress !== auth.address) {
    return NextResponse.json({ ok: false, error: "not your dare" }, { status: 403 });
  }
  if (dare.maxCapacity > 1) {
    return NextResponse.json(
      { ok: false, error: "this is a room; submit proof for your seat" },
      { status: 409 }
    );
  }
  const priorVerdict = dare.verifierResult?.status;
  const isReplacement = dare.status === "SUBMITTED";
  // A submitted proof can be replaced while the ruling is not VALID, attempts
  // remain, and the deadline has not passed.
  if (isReplacement && !canResubmit(dare, dare.proofAttempts, priorVerdict)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          priorVerdict === "VALID"
            ? "this dare has already been ruled valid"
            : `no proof attempts left (limit ${MAX_PROOF_ATTEMPTS})`,
      },
      { status: 409 }
    );
  }
  // A stake that was never deposited cannot be proven: the sweep pays a VALID
  // ruling out of escrow, so an unfunded dare would be paid with other people's
  // deposits.
  if (!dare.fundedAt) {
    return NextResponse.json(
      { ok: false, error: "fund the dare before submitting proof" },
      { status: 409 }
    );
  }
  if (!isReplacement && dare.status !== "ACTIVE") {
    return NextResponse.json(
      { ok: false, error: `cannot submit proof in state ${dare.status}` },
      { status: 409 }
    );
  }
  if (new Date(dare.deadline).getTime() <= Date.now()) {
    return NextResponse.json({ ok: false, error: "the deadline has passed" }, { status: 409 });
  }

  const body = (await req.json().catch(() => null)) as {
    proofImage?: string;
    proofLink?: string;
  } | null;
  const { proofImage, proofLink } = body ?? {};

  const needsImage = dare.verifierKind === "VISION";
  if (needsImage && !isDataUrl(proofImage)) {
    return NextResponse.json(
      { ok: false, error: "proofImage must be a data:image base64 URL" },
      { status: 400 }
    );
  }
  if (proofImage && Buffer.byteLength(proofImage, "utf8") > MAX_IMAGE_BYTES) {
    return NextResponse.json({ ok: false, error: "proof image too large" }, { status: 400 });
  }
  if (!needsImage && !proofImage && !proofLink) {
    return NextResponse.json(
      { ok: false, error: "proofLink required for this verifier" },
      { status: 400 }
    );
  }

  let proofHash: string | null = null;
  if (proofImage) {
    const gate = await gateProofImage(proofImage, dare.proofAttempts, { dareId: dare.id });
    if (!gate.ok) {
      return NextResponse.json({ ok: false, error: gate.error }, { status: gate.httpStatus ?? 400 });
    }
    proofHash = gate.hash ?? null;
  }

  const attempts = dare.proofAttempts + 1;
  const submitted = await store.updateDare(id, {
    proofImageUrl: proofImage ?? null,
    proofHash,
    proofAttempts: attempts,
    verifierLink: dare.verifierLink ?? proofLink ?? null,
    status: "SUBMITTED",
    verifierResult: {
      status: "WAITING",
      reason: "queued for adjudication",
      // Solo dares have no proofLink column: keep the submitted artifact in
      // the verifier record so the deadline sweep can still judge offline cases.
      observations: proofLink ?? undefined,
    },
  });

  // Judge now rather than at the deadline, so a rejected or inconclusive proof
  // can still be replaced while the dare is open.
  const verdict = await adjudicateDare(submitted ?? dare);
  if (verdict.status === "UNAVAILABLE") {
    // The verifier was offline: do not spend the attempt, and let the sweep
    // rule at the deadline.
    const held = await store.updateDare(id, {
      proofAttempts: dare.proofAttempts,
      verifierResult: {
        status: "UNAVAILABLE",
        reason: verdict.reason,
        source: verdict.source,
        observations: proofLink ?? undefined,
      },
    });
    return NextResponse.json(
      {
        ok: true,
        verdict: "UNAVAILABLE",
        reason: verdict.reason,
        attemptsLeft: MAX_PROOF_ATTEMPTS - dare.proofAttempts,
        dare: held ? dareToClient(held) : null,
        store: store.label,
      },
      { status: 201 }
    );
  }

  await store.updateDare(id, {
    verifierResult: verdictToRecord({
      ...verdict,
      observations: proofLink ?? verdict.observations,
    }),
  });

  // A verified solo dare settles immediately: the stake goes back as soon as
  // the proof stands up, with no wait for the deadline.
  let payout: { status: string; txHash?: string; reason?: string } | null = null;
  if (verdict.status === "VALID") {
    payout = await settleSoloWin(id);
  }

  const ruled = await store.getDare(id);
  return NextResponse.json(
    {
      ok: true,
      verdict: verdict.status,
      reason: verdict.reason,
      confidence: verdict.confidence,
      observations: verdict.observations,
      attemptsLeft: verdict.status === "VALID" ? 0 : MAX_PROOF_ATTEMPTS - attempts,
      payout: payout ? { status: payout.status, txHash: payout.txHash, reason: payout.reason } : null,
      dare: ruled ? dareToClient(ruled) : null,
      store: store.label,
    },
    { status: 201 }
  );
}