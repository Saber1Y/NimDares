import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { addressFromPublicKey, verifyNimiqSignature } from "@/lib/verify";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    message?: string;
    publicKey?: string;
    signature?: string;
  } | null;

  const { message, publicKey, signature } = body ?? {};
  if (!message || !publicKey || !signature) {
    return NextResponse.json(
      { ok: false, error: "message, publicKey and signature are required" },
      { status: 400 }
    );
  }

  let address: string;
  try {
    address = addressFromPublicKey(publicKey);
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid public key" },
      { status: 400 }
    );
  }

  const valid = await verifyNimiqSignature({ message, publicKey, signature });
  if (!valid) {
    return NextResponse.json(
      { ok: false, error: "signature verification failed" },
      { status: 401 }
    );
  }

  const store = getStore();
  const user = await store.getOrCreateUser(address);
  return NextResponse.json({
    ok: true,
    user: { address: user.address, id: user.id },
    store: store.label,
  });
}