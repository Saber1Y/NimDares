"server-only";

import { Address, KeyPair, PrivateKey, TransactionBuilder } from "@nimiq/core";

export type NimNetwork = "mainnet" | "testnet";

const NIMIQ_NETWORK: NimNetwork =
  (process.env.NIMIQ_NETWORK ?? "mainnet").toLowerCase() === "testnet" ? "testnet" : "mainnet";
const NIM_NETWORK_ID = Number(process.env.NIM_NETWORK_ID ?? (NIMIQ_NETWORK === "testnet" ? 5 : 24)); // Albatross: testnet=5, mainnet=24
const DEFAULT_RPC =
  NIMIQ_NETWORK === "testnet" ? "https://rpc.testnet.nimiqwatch.com" : "https://rpc.nimiqwatch.com";

function escrowKeyPair(seed: string): KeyPair {
  if (seed.length === 128) return KeyPair.fromHex(seed);
  return KeyPair.derive(PrivateKey.fromHex(seed));
}

interface RpcResponse<T> {
  result?: { data?: T };
  error?: { message?: string; data?: string };
}

async function nimRpc<T>(method: string, params: unknown[], rpcUrl: string): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`NIM RPC ${method} ${res.status}`);
  const payload = (await res.json()) as RpcResponse<T>;
  if (payload.error) throw new Error(`NIM RPC ${method}: ${payload.error.message ?? payload.error.data}`);
  return payload.result!.data!;
}

export interface NimEscrowInfo {
  address: string;
  networkId: number;
  network: NimNetwork;
  configured: boolean;
}

export function getNimEscrowInfo(): NimEscrowInfo {
  const seed = process.env.ESCROW_NIM_KEY_HEX;
  if (!seed) {
    return { address: "", networkId: NIM_NETWORK_ID, network: NIMIQ_NETWORK, configured: false };
  }
  const kp = escrowKeyPair(seed);
  return {
    address: kp.toAddress().toUserFriendlyAddress(),
    networkId: NIM_NETWORK_ID,
    network: NIMIQ_NETWORK,
    configured: true,
  };
}

export async function fetchNimBlockHeight(rpcUrl?: string): Promise<number> {
  const rpc = rpcUrl ?? process.env.NIM_RPC_URL ?? DEFAULT_RPC;
  try {
    return await nimRpc<number>("getBlockNumber", [], rpc);
  } catch {
    return nimRpc<number>("blockNumber", [], rpc);
  }
}

export interface NimSweepResult {
  ok: boolean;
  reason?: string;
  serializedHex?: string;
  txHash?: string;
}

export async function buildNimSweepTx(
  toAddress: string,
  valueLuna: bigint,
  feeLuna: bigint
): Promise<NimSweepResult> {
  const seed = process.env.ESCROW_NIM_KEY_HEX;
  if (!seed) {
    return { ok: false, reason: "ESCROW_NIM_KEY_HEX not configured" };
  }
  const rpc = process.env.NIM_RPC_URL ?? DEFAULT_RPC;
  try {
    const kp = escrowKeyPair(seed);
    const from = kp.toAddress();
    const to = Address.fromUserFriendlyAddress(toAddress);
    const height = await fetchNimBlockHeight(rpc);
    const tx = TransactionBuilder.newBasic(from, to, valueLuna, feeLuna, height, NIM_NETWORK_ID);
    tx.sign(kp, undefined);
    const serialized = tx.serialize();
    const hash = tx.hash();
    try {
      await nimRpc<string>("sendRawTransaction", [Buffer.from(serialized).toString("hex")], rpc);
    } catch (e) {
      return {
        ok: false,
        reason: `broadcast failed: ${e instanceof Error ? e.message : String(e)}`,
        serializedHex: Buffer.from(serialized).toString("hex"),
      };
    }
    return {
      ok: true,
      serializedHex: Buffer.from(serialized).toString("hex"),
      txHash: hash,
    };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function fetchNimBalance(address: string): Promise<bigint> {
  const rpc = process.env.NIM_RPC_URL ?? DEFAULT_RPC;
  const account = await nimRpc<{ balance: number | string }>("getAccountByAddress", [address], rpc).catch(() => ({ balance: 0 }));
  const balance = account.balance ?? "0";
  const raw = typeof balance === "number" ? balance.toString() : balance;
  return BigInt(raw.length > 0 ? raw : "0");
}

export interface NimIncomingTx {
  hash: string;
  fromAddress: string;
  value: bigint;
  memo: string | null;
}

interface NimRpcTx {
  hash: string;
  from: string;
  to: string;
  value: number | string;
  senderData?: string;
  recipientData?: string;
}

const stripSpaces = (address: string) => address.replace(/\s+/g, "");

export async function fetchNimIncomingTxs(address: string): Promise<NimIncomingTx[]> {
  const rpc = process.env.NIM_RPC_URL ?? DEFAULT_RPC;
  const addr = stripSpaces(address);
  const txs = await nimRpc<NimRpcTx[]>("getTransactionsByAddress", [addr, 100, null], rpc);
  return txs
    .filter((t) => stripSpaces(t.to) === addr)
    .map((t) => ({
      hash: t.hash,
      fromAddress: t.from,
      value: BigInt(t.value),
      memo: t.recipientData ? parseMemo(t.recipientData) : null,
    }));
}

function parseMemo(data?: string | null): string | null {
  if (!data) return null;
  const hex = data.startsWith("0x") || data.startsWith("0X") ? data.slice(2) : data;
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  try {
    const bytes = Buffer.from(hex, "hex");
    const text = bytes.toString("utf8");
    return text.startsWith("nimdares:") ? text : null;
  } catch {
    return null;
  }
}