"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { init, type NimiqProvider, type SignatureResult } from "@nimiq/mini-app-sdk";
import { NIM_DECIMALS, nimRpcUrlFor } from "@/lib/config";
import { formatProviderError } from "@/lib/errors";

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
  ) => Promise<{
    ok: boolean;
    txRef?: string;
    error?: string;
    /** The call threw: the payment may still have been broadcast. Never re-send on this. */
    indeterminate?: boolean;
  }>;
  /**
   * Largest single-account balance in NIM, or null when none can be read.
   * A transaction is paid from one account, so this - not the total - is what
   * an amount has to fit inside.
   */
  getBalance: () => Promise<number | null>;
  /** Cached per-account snapshots from the last read. Empty until one runs. */
  balances: NimAccountSnapshot[];
  /** Sum across every listed account. For display only; nothing can spend it at once. */
  totalNim: number | null;
  /** Reads every address listAccounts() returned, in parallel. */
  getAccountSnapshots: (force?: boolean) => Promise<NimAccountSnapshot[]>;
  /** Raw account data for the primary address. */
  getAccountSnapshot: () => Promise<NimAccountSnapshot | null>;
  /** Block height of the network the Pay host is on, or null when unreadable. */
  getBlockNumber: () => Promise<number | null>;
  connect: () => Promise<void>;
}

export interface NimAccountSnapshot {
  address: string;
  balanceLuna: number;
  balanceNim: number;
  accountType: string;
  blockNumber: number | null;
}

/** Addresses read per refresh. The public RPC is rate limited; wallets hold few accounts. */
const MAX_ACCOUNTS_QUERIED = 5;
/** Reuse window, so several components mounting at once make one round trip. */
const SNAPSHOT_TTL_MS = 10_000;

const normalize = (address: string) => address.replace(/\s+/g, "").toUpperCase();

const WalletContext = createContext<WalletState | null>(null);

export function isErrorResponse(v: unknown): v is { error: { type: string; message: string } } {
  return typeof v === "object" && v !== null && "error" in v;
}

export function NimiqWalletProvider({ children }: { children: ReactNode }) {
  const [provider, setProvider] = useState<NimiqProvider | null>(null);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [network, setNetwork] = useState<string | null>(null);
  const [balances, setBalances] = useState<NimAccountSnapshot[]>([]);
  const snapshotCache = useRef<{ at: number; key: string; data: NimAccountSnapshot[] } | null>(null);
  const [status, setStatus] = useState<WalletStatus>("initializing");
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    try {
      setStatus("initializing");
      const prov = await init({ timeout: 10_000 });
      // The wallet only handles account/sign/send methods; anything else the
      // SDK forwards to this RPC, which is how balances are read. The SDK's
      // getNetwork() always returns "nimiq", so resolve the RPC from the
      // build-time network and surface the effective network for display.
      const rpcUrl = nimRpcUrlFor(prov.getNetwork());
      prov.setRPCUrl(rpcUrl);
      setProvider(prov);
      setNetwork(rpcUrl.includes("testnet") ? "testnet" : "mainnet");
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
      const msg = formatProviderError(e, "could not reach the Nimiq Pay host");
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
    ): Promise<{ ok: boolean; txRef?: string; error?: string; indeterminate?: boolean }> => {
      if (!provider) return { ok: false, error: "wallet not connected" };
      setStatus("signing");
      try {
        const res = await provider.sendBasicTransactionWithData({
          recipient,
          value: valueLuna,
          // Plain text, not hex: Nimiq Pay encodes it into the transaction
          // itself. Passing hex made the host encode that string in turn, which
          // doubled its length past the 64-byte recipient-data cap and came
          // back as "Transaction invalidated during transaction".
          data: memo,
        });
        if (isErrorResponse(res)) {
          const msg = formatProviderError(res, "the payment was declined");
          setError(msg);
          return { ok: false, error: msg };
        }
        setError(null);
        // Hosts return either the transaction hash or the serialized
        // transaction; the server resolves both to a hash.
        return { ok: true, txRef: typeof res === "string" ? res : undefined };
      } catch (e) {
        // The bridge threw rather than answering. The host may well have
        // broadcast the transaction already, so this is not a refusal.
        console.error("sendPayTransaction failed", e);
        const msg = formatProviderError(e, "the payment could not be confirmed with the wallet");
        setError(msg);
        return { ok: false, error: msg, indeterminate: true };
      } finally {
        setStatus((s) => (s === "signing" ? "ready" : s));
      }
    },
    [provider]
  );

  /**
   * listAccounts() returns addresses only - the SDK exposes no balance method -
   * so each address is resolved against the configured NIM RPC. One block-height
   * read is shared by all of them, the per-account reads run in parallel, and a
   * single failed address yields that entry rather than the whole batch.
   */
  const getAccountSnapshots = useCallback(
    async (force = false): Promise<NimAccountSnapshot[]> => {
      if (!provider || accounts.length === 0) return [];

      const seen = new Set<string>();
      const targets = accounts
        .filter((address) => {
          const key = normalize(address);
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, MAX_ACCOUNTS_QUERIED);
      if (targets.length === 0) return [];

      const cacheKey = targets.map(normalize).join("|");
      const cached = snapshotCache.current;
      if (
        !force &&
        cached &&
        cached.key === cacheKey &&
        Date.now() - cached.at < SNAPSHOT_TTL_MS
      ) {
        return cached.data;
      }

      try {
        provider.setRPCUrl(nimRpcUrlFor(network));
        const [blockNumber, results] = await Promise.all([
          provider.getBlockNumber().catch(() => null),
          Promise.all(
            targets.map(async (address) => {
              try {
                // The SDK's RPC client unwraps the Albatross `{ data, metadata }`
                // envelope, so this resolves to the account record itself.
                const account = await provider.request<{
                  address?: string;
                  balance?: number | string;
                  type?: string;
                } | null>({ method: "getAccountByAddress", params: [address] });
                return { address, account };
              } catch (e) {
                console.warn("getAccountByAddress failed", address, e);
                return { address, account: null };
              }
            })
          ),
        ]);

        const snapshots = results.flatMap(({ address, account }) => {
          const luna = account?.balance;
          if (luna === undefined || luna === null) return [];
          const balanceLuna = Number(luna);
          const balanceNim = balanceLuna / NIM_DECIMALS;
          // A balance we cannot read must not be reported as zero.
          if (!Number.isFinite(balanceLuna) || !Number.isFinite(balanceNim)) return [];
          return [
            {
              address: account?.address ?? address,
              balanceLuna,
              balanceNim,
              // Anything other than "basic" can hold funds that are not
              // spendable yet, such as a vesting contract's unreleased amount.
              accountType: account?.type ?? "unknown",
              blockNumber,
            },
          ];
        });

        snapshotCache.current = { at: Date.now(), key: cacheKey, data: snapshots };
        setBalances(snapshots);
        return snapshots;
      } catch (e) {
        console.warn("getAccountSnapshots failed", e);
        return [];
      }
    },
    [provider, accounts, network]
  );

  const getAccountSnapshot = useCallback(async (): Promise<NimAccountSnapshot | null> => {
    const snapshots = await getAccountSnapshots();
    return snapshots[0] ?? null;
  }, [getAccountSnapshots]);

  const getBalance = useCallback(async (): Promise<number | null> => {
    const snapshots = await getAccountSnapshots();
    if (snapshots.length === 0) return null;
    // Highest single account, not the sum: one transaction spends from one account.
    return snapshots.reduce((best, s) => Math.max(best, s.balanceNim), 0);
  }, [getAccountSnapshots]);

  useEffect(() => {
    // Warm the balances once the host hands over its accounts, so consumers can
    // read wallet.balances without each firing its own request.
    if (!provider || accounts.length === 0) return;
    // Fetching account state is exactly the external read an effect is for; the
    // state it sets lands asynchronously, not during this render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void getAccountSnapshots();
  }, [provider, accounts, getAccountSnapshots]);

  const getBlockNumber = useCallback(async (): Promise<number | null> => {
    if (!provider) return null;
    try {
      return await provider.getBlockNumber();
    } catch (e) {
      console.warn("getBlockNumber failed", e);
      return null;
    }
  }, [provider]);

  const totalNim = useMemo(
    () => (balances.length === 0 ? null : balances.reduce((sum, b) => sum + b.balanceNim, 0)),
    [balances]
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
      getBalance,
      balances,
      totalNim,
      getAccountSnapshots,
      getAccountSnapshot,
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
      balances,
      totalNim,
      getAccountSnapshots,
      getAccountSnapshot,
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
