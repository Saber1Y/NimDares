import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { authenticate } from "@/lib/verify";
import { dareToClient } from "@/lib/serialize";

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
  if (dare.status !== "ACTIVE" && dare.status !== "PENDING_FUNDING") {
    return NextResponse.json(
      { ok: false, error: `cannot submit proof in state ${dare.status}` },
      { status: 409 }
    );
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

  const updated = await store.updateDare(id, {
    proofImageUrl: proofImage ?? null,
    verifierLink: dare.verifierLink ?? proofLink ?? null,
    status: "SUBMITTED",
    verifierResult: { status: "WAITING", reason: "queued for adjudication" },
  });

  return NextResponse.json(
    { ok: true, dare: updated ? dareToClient(updated) : null, store: store.label },
    { status: 201 }
  );
}