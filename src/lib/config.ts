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

export const ESCROW_FEE_BPS = 100; // 1% protocol fee on wins, allocated to slash pool