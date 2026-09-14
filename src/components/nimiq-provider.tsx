"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { init, type NimiqProvider, type SignatureResult } from "@nimiq/mini-app-sdk";
import { NIM_DECIMALS, nimRpcUrlFor } from "@/lib/config";

export type WalletStatus =
  | "initializing"
  | "ready"
  | "no-host"
  | "error"
  | "signing";

interface WalletState {
  status: WalletStatus;
  provider: NimiqProvider | null;
  accounts: string[];
  address: string | null;
  network: string | null;
  error: string | null;
  signMessage: (
    message: string
  ) => Promise<SignatureResult | null>;
  sendPayTransaction: (
    recipient: string,
    valueLuna: number,
    memo: string
  ) => Promise<{ ok: boolean; txRef?: string; error?: string }>;
  /** Spendable NIM for the connected account, or null when it cannot be read. */
  getBalance: () => Promise<number | null>;
  /** Block height of the network the Pay host is on, or null when unreadable. */
  getBlockNumber: () => Promise<number | null>;
  connect: () => Promise<void>;
}

const WalletContext = createContext<WalletState | null>(null);

export function isErrorResponse(v: unknown): v is { error: { type: string; message: string } } {
  return typeof v === "object" && v !== null && "error" in v;
}

export function NimiqWalletProvider({ children }: { children: ReactNode }) {
  const [provider, setProvider] = useState<NimiqProvider | null>(null);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [network, setNetwork] = useState<string | null>(null);
  const [status, setStatus] = useState<WalletStatus>("initializing");
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    try {
      setStatus("initializing");
      const prov = await init({ timeout: 10_000 });
      // The wallet only handles account/sign/send methods; anything else the
      // SDK forwards to this RPC, which is how balances are read. Point it at
      // the RPC for the network the Pay host is actually on.
      const net = prov.getNetwork();
      prov.setRPCUrl(nimRpcUrlFor(net));
      setProvider(prov);
      setNetwork(net);
      const res = await prov.listAccounts();
      if (isErrorResponse(res)) {
        setAccounts([]);
        setError(res.error.message);
      } else {
        setAccounts(res);
        setError(null);
      }
      setStatus("ready");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const noHost =
        msg.toLowerCase().includes("nimiq pay") ||
        msg.toLowerCase().includes("window.nimiq") ||
        msg.toLowerCase().includes("host");
      setStatus(noHost ? "no-host" : "error");
      setError(msg);
    }
  }, []);

  useEffect(() => {
    // Initializes the Nimiq Pay host bridge on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void connect();
  }, [connect]);

  const signMessage = useCallback(
    async (message: string): Promise<SignatureResult | null> => {
      if (!provider) return null;
      setStatus("signing");
      try {
        const res = await provider.sign(message);
        if (isErrorResponse(res)) {
          setError(res.error.message);
          return null;
        }
        setError(null);
        return res;
      } finally {
        setStatus((s) => (s === "signing" ? "ready" : s));
      }
    },
    [provider]
  );

  const sendPayTransaction = useCallback(
    async (
      recipient: string,
      valueLuna: number,
      memo: string
    ): Promise<{ ok: boolean; txRef?: string; error?: string }> => {
      if (!provider) return { ok: false, error: "wallet not connected" };
      setStatus("signing");
      try {
        const bytes = new TextEncoder().encode(memo);
        const dataHex = Array.from(bytes)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        const res = await provider.sendBasicTransactionWithData({
          recipient,
          value: valueLuna,
          data: dataHex,
        });
        if (isErrorResponse(res)) {
          setError(res.error.message);
          return { ok: false, error: res.error.message };
        }
        setError(null);
        // Hosts return either the transaction hash or the serialized
        // transaction; the server resolves both to a hash.
        return { ok: true, txRef: typeof res === "string" ? res : undefined };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        return { ok: false, error: msg };
      } finally {
        setStatus((s) => (s === "signing" ? "ready" : s));
      }
    },
    [provider]
  );

  const getBalance = useCallback(async (): Promise<number | null> => {
    const address = accounts[0];
    if (!provider || !address) return null;
    try {
      provider.setRPCUrl(nimRpcUrlFor(network));
      // The SDK's RPC client unwraps the Albatross `{ data, metadata }` envelope,
      // so this resolves to the account record itself. Balance is in Luna.
      const account = await provider.request<{ balance?: number | string } | null>({
        method: "getAccountByAddress",
        params: [address],
      });
      const luna = account?.balance;
      if (luna === undefined || luna === null) return null;
      const nim = Number(luna) / NIM_DECIMALS;
      return Number.isFinite(nim) ? nim : null;
    } catch (e) {
      // A balance we cannot read must not be reported as zero.
      console.warn("getBalance failed", e);
      return null;
    }
  }, [provider, accounts, network]);

  const getBlockNumber = useCallback(async (): Promise<number | null> => {
    if (!provider) return null;
    try {
      return await provider.getBlockNumber();
    } catch (e) {
      console.warn("getBlockNumber failed", e);
      return null;
    }
  }, [provider]);

  const value = useMemo<WalletState>(
    () => ({
      status,
      provider,
      accounts,
      address: accounts[0] ?? null,
      network,
      error,
      signMessage,
      sendPayTransaction,
      getBalance,
      getBlockNumber,
      connect,
    }),
    [
      status,
      provider,
      accounts,
      network,
      error,
      signMessage,
      sendPayTransaction,
      getBalance,
      getBlockNumber,
      connect,
    ]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useNimiqWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useNimiqWallet must be used within NimiqWalletProvider");
  return ctx;
}