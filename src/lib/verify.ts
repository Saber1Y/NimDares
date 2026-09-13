"server-only";

import { verifyAsync } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha2.js";
import { blake2b } from "@noble/hashes/blake2.js";
import { Address, PublicKey } from "@nimiq/core";

export const NIMIQ_SIGNED_MESSAGE_PREFIX = "\x16Nimiq Signed Message:\n";

export function addressFromPublicKey(publicKeyHex: string): string {
  const raw = PublicKey.fromHex(publicKeyHex).serialize();
  const hash = blake2b(raw, { dkLen: 32 });
  return new Address(hash.subarray(0, 20)).toUserFriendlyAddress();
}

export function nimiqMessageDigest(message: string): Uint8Array {
  // Nimiq Keyguard protocol: sign(sha256(MSG_PREFIX + message.length + message)).
  // message.length is the JS string length, matching the client/wallet behavior.
  const data = `${NIMIQ_SIGNED_MESSAGE_PREFIX}${message.length}${message}`;
  return sha256(new TextEncoder().encode(data));
}

export async function verifyNimiqSignature(args: {
  message: string;
  publicKey: string;
  signature: string;
}): Promise<boolean> {
  try {
    const pubRaw = Uint8Array.from(Buffer.from(args.publicKey, "hex"));
    const sigRaw = Uint8Array.from(Buffer.from(args.signature, "hex"));
    const digest = nimiqMessageDigest(args.message);
    return await verifyAsync(sigRaw, digest as Uint8Array, pubRaw);
  } catch {
    return false;
  }
}

export interface AuthResult {
  ok: boolean;
  address?: string;
  error?: string;
}

export function parseAuthHeader(header: string | null): {
  publicKey: string;
  signature: string;
  message: string;
} | null {
  if (!header) return null;
  const [scheme, payload] = header.split(" ");
  if (scheme !== "Nimiq" || !payload) return null;
  const parts = payload.split(":");
  if (parts.length !== 3) return null;
  const [publicKey, signature, messageB64] = parts;
  if (!publicKey || !signature || !messageB64) return null;
  try {
    const message = Buffer.from(messageB64, "base64url").toString("utf8");
    return { publicKey, signature, message };
  } catch {
    return null;
  }
}

export async function authenticate(request: Request): Promise<AuthResult> {
  const parsed = parseAuthHeader(request.headers.get("authorization"));
  if (!parsed) {
    return { ok: false, error: "missing or malformed Nimiq Authorization header" };
  }
  const address = addressFromPublicKey(parsed.publicKey);
  const valid = await verifyNimiqSignature(parsed);
  if (!valid) {
    return { ok: false, error: "signature verification failed" };
  }
  return { ok: true, address };
}