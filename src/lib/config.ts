export const NIM_DECIMALS = 100_000;

export type Asset = "NIM" | "USDT";

export type EvmNetwork = "amoy" | "mainnet";

export const NETWORK: EvmNetwork =
  (process.env.NEXT_PUBLIC_NETWORK as EvmNetwork | undefined) ?? "amoy";

export const EVM_NETWORKS = {
  mainnet: {
    chainId: 137,
    chainIdHex: "0x89",
    name: "Polygon Mainnet",
    usdtContract: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    rpcUrl: "https://polygon-rpc.com",
    explorer: "https://polygonscan.com",
    pay: true,
  },
  amoy: {
    chainId: 80002,
    chainIdHex: "0x13882",
    name: "Polygon Amoy",
    usdtContract: "0x2Fd5885cC4bbbC06c883CA6673434ddDf4391943",
    rpcUrl: "https://rpc-amoy.polygon.technology",
    explorer: "https://amoy.polygonscan.com",
    pay: false,
  },
} as const;

export function usdtContractAddress(): string {
  return EVM_NETWORKS[NETWORK].usdtContract;
}

export function evmChainId(): number {
  return EVM_NETWORKS[NETWORK].chainId;
}

export function shouldUseEvmBridge(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as { ethereum?: unknown }).ethereum === "object"
  );
}

export const SLASH_POOL_ADDRESS =
  process.env.SLASH_POOL_ADDRESS ?? "NQ07 0000 0000 0000 0000 0000 0000 0000 0000";

/**
 * Platform cut on pooled dares, in basis points. Charged only on the
 * redistributed pot - the stakes forfeited by seats that failed to verify -
 * never on a player's own returned stake. Solo dares pay no fee.
 */
export const POOL_FEE_BPS = Number(process.env.POOL_FEE_BPS ?? 200); // 2%
export type NimNetwork = "mainnet" | "testnet";

// Client-visible Nimiq network + RPC endpoint. The Mini App SDK exposes no
// balance method, so the provider is pointed at this RPC and read-only calls
// are routed through it (see components/nimiq-provider.tsx).
export const NIM_NETWORK: NimNetwork =
  (process.env.NEXT_PUBLIC_NIMIQ_NETWORK ?? "mainnet").toLowerCase() === "testnet"
    ? "testnet"
    : "mainnet";

export const NIM_RPC_URL =
  process.env.NEXT_PUBLIC_NIM_RPC_URL ??
  (NIM_NETWORK === "testnet"
    ? "https://rpc.testnet.nimiqwatch.com"
    : "https://rpc.nimiqwatch.com");

/** Resolves the RPC for network the wallet sits on. An explicit
 *  NEXT_PUBLIC_NIM_RPC_URL override always wins. The mini-app SDK's
 *  getNetwork() always reports the static name "nimiq", so when the host
 *  network string is that generic value the build-time NEXT_PUBLIC_NIMIQ_NETWORK
 *  decides, keeping a testnet demo off the mainnet RPC. */
export function nimRpcUrlFor(network: string | null | undefined): string {
  const override = process.env.NEXT_PUBLIC_NIM_RPC_URL;
  if (override) return override;
  const net =
    network && network !== "nimiq"
      ? network
      : process.env.NEXT_PUBLIC_NIMIQ_NETWORK ?? "mainnet";
  return net.toLowerCase().startsWith("test")
    ? "https://rpc.testnet.nimiqwatch.com"
    : "https://rpc.nimiqwatch.com";
}

// Nimiq caps a transaction's recipient data (the memo) at 64 bytes; anything
// longer fails consensus verification with "Overflow".
export const NIM_MAX_TX_DATA_BYTES = 64;

// Proof attempts per stake. Mirrors MAX_PROOF_ATTEMPTS in lib/proof-intake.ts,
// which is the server-side authority.
export const MAX_PROOF_ATTEMPTS = 3;
