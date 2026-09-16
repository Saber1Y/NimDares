"use client";

// node/webpack polyfill versions disagree on `base64url` support, so encode
// through TextEncoder + btoa instead.
export function base64UrlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Builds the `Authorization: Nimiq <pub>:<sig>:<base64url(msg)>` header the
 * server parses back through parseAuthHeader. The server only verifies the
 * signature; the message content is client-side convention, so a single
 * signed read credential is valid across every read route.
 */
export function buildReadAuth(
  publicKey: string,
  signature: string,
  message: string,
): string {
  return `Nimiq ${publicKey}:${signature}:${base64UrlEncode(message)}`;
}

const AUTH_KEY_PREFIX = "nimdares.readAuth.";

function authStorageKey(network: string | null, address: string): string {
  return `${AUTH_KEY_PREFIX}${network ?? "nimiq"}.${address.replace(/\s+/g, "").toUpperCase()}`;
}

/** Resume a previously signed read credential for this wallet+network, if any. */
export function readStoredAuth(network: string | null, address: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(authStorageKey(network, address));
  } catch {
    return null;
  }
}

export function storeAuth(
  network: string | null,
  address: string,
  header: string,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(authStorageKey(network, address), header);
  } catch {
    // storage unavailable (private mode): the credential still lives in memory
  }
}

export function clearStoredAuth(network: string | null, address: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(authStorageKey(network, address));
  } catch {
    // ignore
  }
}