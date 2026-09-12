"server-only";

import { ethers } from "ethers";
import { EVM_NETWORKS, NETWORK, evmChainId } from "@/lib/config";

const USDT_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
];

export interface EvmEscrowInfo {
  address: string;
  chainId: number;
  configured: boolean;
}

export function getEvmEscrowInfo(): EvmEscrowInfo {
  const seed = process.env.ESCROW_EVM_KEY_HEX;
  if (!seed) return { address: "", chainId: evmChainId(), configured: false };
  return {
    address: new ethers.Wallet(seed).address,
    chainId: evmChainId(),
    configured: true,
  };
}

function evmSigner() {
  const seed = process.env.ESCROW_EVM_KEY_HEX;
  if (!seed) return null;
  const rpc = process.env.EVM_RPC_URL ?? EVM_NETWORKS[NETWORK].rpcUrl;
  const provider = new ethers.JsonRpcProvider(rpc, evmChainId(), { staticNetwork: true });
  return new ethers.Wallet(seed, provider);
}

export async function fetchUsdtBalance(address: string): Promise<bigint> {
  const rpc = process.env.EVM_RPC_URL ?? EVM_NETWORKS[NETWORK].rpcUrl;
  const provider = new ethers.JsonRpcProvider(rpc, evmChainId(), { staticNetwork: true });
  const contract = new ethers.Contract(
    EVM_NETWORKS[NETWORK].usdtContract,
    USDT_ABI,
    provider
  );
  return (await contract.balanceOf(address)) as bigint;
}

export interface UsdtPayoutResult {
  ok: boolean;
  reason?: string;
  txHash?: string;
}

export async function sendUsdtPayout(
  toAddress: string,
  amountRaw: bigint
): Promise<UsdtPayoutResult> {
  const signer = evmSigner();
  if (!signer) {
    return { ok: false, reason: "ESCROW_EVM_KEY_HEX not configured" };
  }
  try {
    const contract = new ethers.Contract(
      EVM_NETWORKS[NETWORK].usdtContract,
      USDT_ABI,
      signer
    );
    const tx = await contract.transfer(toAddress, amountRaw);
    await tx.wait(2);
    return { ok: true, txHash: tx.hash };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}