import { NIM_DECIMALS } from "@/lib/config";

export function lunaToNim(luna: number | bigint): string {
  const v = Number(luna) / NIM_DECIMALS;
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function nimToLuna(nim: number): number {
  return Math.round(nim * NIM_DECIMALS);
}

export function usdtToken(usdt: number): number {
  return Math.round(usdt * 1_000_000);
}

export function tokenToUsdt(raw: number | bigint): string {
  return (Number(raw) / 1_000_000).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}

export function shortHash(hash: string, len = 8): string {
  if (!hash || hash.length <= len * 2 + 2) return hash ?? "";
  return `${hash.slice(0, len)}…${hash.slice(-len)}`;
}

export function timeLeft(deadline: string | Date): string {
  const ms = new Date(deadline).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  if (days > 0) return `${days}d ${hours}h`;
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  return `${hours}h ${mins}m`;
}