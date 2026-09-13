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
  ) => Promise<{ ok: boolean; error?: string }>;
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
      setProvider(prov);
      setNetwork(prov.getNetwork());
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
    ): Promise<{ ok: boolean; error?: string }> => {
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
        return { ok: true };
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
      connect,
    }),
    [status, provider, accounts, network, error, signMessage, sendPayTransaction, connect]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useNimiqWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useNimiqWallet must be used within NimiqWalletProvider");
  return ctx;
}