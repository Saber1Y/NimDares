"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  Wallet,
  CircleAlert,
  Check,
  ImageIcon,
  Users,
  Globe,
  Hash,
  Copy,
  Loader2,
} from "lucide-react";
import { useNimiqWallet } from "@/components/nimiq-provider";
import { HudPanel } from "@/components/ui/hud-panel";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import type { Asset, RoomMode, VerifierKind } from "@/lib/types";
import { NIM_MAX_TX_DATA_BYTES } from "@/lib/config";

type FundStep = "funding" | "paid" | "cancelled" | "failed";

type CreateState =
  | { phase: "idle" }
  | { phase: "signing" }
  | { phase: "submitting" }
  | {
      phase: "created";
      step: FundStep;
      error: string | null;
      escrowAddress: string | null;
      escrowConfigured: boolean;
      asset: Asset;
      amount: number;
      mode: RoomMode;
      maxCapacity: number;
      roomCode: string | null;
      dareId: string;
      participantId: string | null;
      /** Checklist the judge will hold the screenshot to. */
      evidenceSpec: { requirements: string[]; expectedArtifact: string } | null;
      /** True once the wallet has accepted the escrow payment. Blocks re-sending it. */
      paymentSent: boolean;
      /** Wallet reference for that payment, replayed when confirmation is retried. */
      txRef: string | null;
    }
  | { phase: "error"; message: string };

// Screenshot proof is the only verifier: one evidence path, one adjudicator.
const VERIFIER: VerifierKind = "VISION";

const MODES: {
  mode: RoomMode;
  label: string;
  icon: typeof Users;
  hint: string;
}[] = [
  {
    mode: "solo",
    label: "Solo",
    icon: Hash,
    hint: "One commitment, one stake, one verdict",
  },
  {
    mode: "team",
    label: "Team",
    icon: Users,
    hint: "A private room your circle joins by invite code",
  },
  {
    mode: "arena",
    label: "Arena",
    icon: Globe,
    hint: "A public table anyone can join from the arena feed",
  },
];

function base64UrlEncode(s: string): string {
  const b64 = btoa(unescape(encodeURIComponent(s)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function extractError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e)
    return String((e as { message: unknown }).message);
  try {
    const s = JSON.stringify(e);
    return s && s !== "{}" ? s : "An unknown error occurred";
  } catch {
    return "An unknown error occurred";
  }
}

export default function CreateDare() {
  const wallet = useNimiqWallet();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [criteria, setCriteria] = useState("");
  const [asset, setAsset] = useState<Asset>("NIM");
  const [amount, setAmount] = useState("1");
  const [deadline, setDeadline] = useState("");
  const [mode, setMode] = useState<RoomMode>("solo");
  const [capacity, setCapacity] = useState("5");
  const [state, setState] = useState<CreateState>({ phase: "idle" });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function startClientPolling(
    created: Extract<CreateState, { phase: "created" }>,
  ) {
    if (pollRef.current) clearInterval(pollRef.current);
    const startedAt = Date.now();
    // Reading a dare settles a deposit that was not in a block yet, so this
    // both polls and drives the confirmation.
    const check = async () => {
      try {
        const res = await fetch(`/api/dares/${created.dareId}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        const dare = data.dare as { status?: string } | undefined;
        if (dare && dare.status === "ACTIVE") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setState({ ...created, step: "paid", error: null });
        }
      } catch {
        // transient error, keep polling
      }
      if (Date.now() - startedAt >= 5 * 60_000) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        setState({
          ...created,
          step: "failed",
          error: "funding confirmation timed out after 5 minutes",
        });
      }
    };
    void check();
    pollRef.current = setInterval(() => void check(), 5_000);
  }

  /** Hands the payment reference to the server, which settles it against the chain. */
  async function confirmFunding(
    created: Extract<CreateState, { phase: "created" }>,
    authHeader: string,
  ) {
    let data: { ok?: boolean; status?: string; error?: string };
    try {
      const fund = await fetch(`/api/dares/${created.dareId}/fund`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: authHeader,
        },
        body: JSON.stringify({
          asset: created.asset,
          txRef: created.txRef ?? undefined,
          participantId: created.participantId ?? undefined,
        }),
      });
      data = (await fund.json()) as { ok?: boolean; status?: string; error?: string };
      if (!fund.ok || !data.ok) {
        setState({
          ...created,
          step: "failed",
          error: data.error ?? "could not confirm the escrow deposit",
        });
        return;
      }
    } catch (e) {
      setState({ ...created, step: "failed", error: extractError(e) });
      return;
    }

    if (data.status === "funded") {
      setState({ ...created, step: "paid", error: null });
      return;
    }
    // Broadcast but not in a block yet: reads settle it, so keep polling.
    setState({ ...created, step: "funding", error: null });
    startClientPolling(created);
  }

  async function stakeAndFund(
    created: Extract<CreateState, { phase: "created" }>,
    authHeader: string,
  ) {
    if (created.asset !== "NIM" || !created.escrowAddress) {
      setState({
        ...created,
        step: "failed",
        error: "native payment is only for NIM escrow",
      });
      return;
    }
    if (created.paymentSent) {
      // Never send a second payment for a stake that already left the wallet.
      void confirmFunding(created, authHeader);
      return;
    }
    // The escrow scanner resolves the seat from this reference alone, so the
    // memo stays well inside the 64-byte recipient-data cap.
    const memo = `nimdares:${created.participantId ?? created.dareId}`;
    if (new TextEncoder().encode(memo).length > NIM_MAX_TX_DATA_BYTES) {
      setState({
        ...created,
        step: "failed",
        error: "funding reference is too long for a Nimiq transaction",
      });
      return;
    }

    const valueLuna = Math.round(created.amount * 100_000);
    const res = await wallet.sendPayTransaction(
      created.escrowAddress,
      valueLuna,
      memo,
    );
    if (!res.ok) {
      // Declined or failed in Nimiq Pay: the dare stays staged and unfunded.
      setState({
        ...created,
        step: "cancelled",
        error: res.error ?? "payment was cancelled in Nimiq Pay",
      });
      return;
    }

    const sent = { ...created, paymentSent: true, txRef: res.txRef ?? null };
    setState({ ...sent, step: "funding", error: null });
    void confirmFunding(sent, authHeader);
  }

  async function handleCreate() {
    if (!wallet.address || wallet.status !== "ready") {
      setState({
        phase: "error",
        message: "wallet not connected; cannot sign the creation proof",
      });
      return;
    }
    if (
      !title.trim() ||
      !description.trim() ||
      !criteria.trim() ||
      !amount ||
      !deadline
    ) {
      setState({ phase: "error", message: "all fields are required" });
      return;
    }
    const amountNum = Number(amount);
    if (amountNum <= 0) {
      setState({ phase: "error", message: "amount must be greater than zero" });
      return;
    }

    if (asset === "NIM") {
      // A null balance means the RPC read failed - let the funding step decide
      // rather than blocking the user with a bogus "insufficient" message.
      const balance = await wallet.getBalance();
      if (balance !== null && balance < amountNum) {
        setState({
          phase: "error",
          message: `insufficient NIM balance. You have ${balance.toFixed(2)} NIM, need ${amountNum}`,
        });
        return;
      }
    }

    const message = `nimdares:create:${Date.now()}:${title.trim().slice(0, 40)}`;
    setState({ phase: "signing" });
    const sig = await wallet.signMessage(message);
    if (!sig) {
      setState({
        phase: "error",
        message: "wallet signature failed or was rejected",
      });
      return;
    }

    setState({ phase: "submitting" });
    const authHeader = `Nimiq ${sig.publicKey}:${sig.signature}:${base64UrlEncode(message)}`;
    try {
      const res = await fetch("/api/dares", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: authHeader,
        },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          criteria: criteria.trim(),
          asset,
          amount: Number(amount),
          deadline: new Date(deadline).toISOString(),
          verifierKind: VERIFIER,
          mode,
          maxCapacity: mode === "solo" ? undefined : Number(capacity),
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        escrow?: { address: string | null; configured: boolean };
        dare?: {
          id: string;
          maxCapacity: number;
          roomCode: string | null;
          evidenceSpec?: { requirements: string[]; expectedArtifact: string } | null;
        };
        participants?: { id: string }[];
      };
      if (!res.ok || !data.ok) {
        setState({
          phase: "error",
          message: data?.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      const created: Extract<CreateState, { phase: "created" }> = {
        phase: "created",
        step: asset === "NIM" ? "funding" : "cancelled",
        error: null,
        escrowAddress: data.escrow?.address ?? null,
        escrowConfigured: data.escrow?.configured ?? false,
        asset,
        amount: Number(amount),
        mode,
        maxCapacity: data.dare?.maxCapacity ?? 1,
        roomCode: data.dare?.roomCode ?? null,
        dareId: data.dare?.id ?? "",
        participantId: data.participants?.[0]?.id ?? null,
        evidenceSpec: data.dare?.evidenceSpec ?? null,
        paymentSent: false,
        txRef: null,
      };
      setState(created);
      if (created.asset === "NIM") {
        void stakeAndFund(created, authHeader);
      }
    } catch (e) {
      setState({
        phase: "error",
        message: extractError(e),
      });
    }
  }

  if (state.phase === "created") {
    const c = state;
    const isRoom = c.mode !== "solo";
    const isPaid = c.step === "paid";
    const isConfirming = c.step === "funding";
    const isCancelled = c.step === "cancelled";
    return (
      <div className="mx-auto max-w-2xl">
        {isConfirming && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mx-4 w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-2xl"
            >
              <div className="flex flex-col items-center gap-5 text-center">
                <Loader2 className="size-10 text-primary animate-spin" />
                <div>
                  <p className="text-lg font-semibold text-foreground">
                    Confirming funds on-chain
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Your {c.amount} {c.asset} payment was sent. Waiting for the
                    Nimiq network to confirm the deposit into escrow.
                  </p>
                </div>
                <p className="font-mono text-[11px] text-muted-foreground">
                  This usually takes a few seconds. You can close this dialog —
                  the dare will update automatically.
                </p>
                <Button href={`/app/dare/${c.dareId}`}>
                  Open dare page <ArrowRight className="size-4" />
                </Button>
              </div>
            </motion.div>
          </div>
        )}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <HudPanel
            label={
              isPaid
                ? "Dare live"
                : isConfirming
                  ? "Confirming funds"
                  : isCancelled
                    ? "Dare staged"
                    : isRoom
                      ? "Room opened"
                      : "Dare staged"
            }
            icon={<Check className="size-3.5" />}
            badge={
              isPaid
                ? "LIVE / ON-CHAIN"
                : isConfirming
                  ? "CONFIRMING"
                  : isRoom
                    ? "LOBBY"
                    : "PENDING / FUNDING"
            }
          >
            <div className="flex flex-col gap-6">
              {c.evidenceSpec && (
                <div className="rounded-2xl border border-border bg-muted/20 px-5 py-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    Proof checklist · agreed now, judged later
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Submit {c.evidenceSpec.expectedArtifact}. It must show:
                  </p>
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {c.evidenceSpec.requirements.map((r, i) => (
                      <li key={i} className="flex gap-2 text-xs leading-relaxed text-foreground/80">
                        <span className="text-primary">{i + 1}.</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {isPaid ? (
                <div className="flex items-start gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-5 py-4">
                  <Check className="mt-0.5 size-5 shrink-0 text-primary" />
                  <p className="text-sm leading-relaxed text-foreground">
                    {isRoom
                      ? `Your seat is locked. Your ${c.amount} ${c.asset} is on-chain in escrow. The room plays once every seat is funded or the deadline passes.`
                      : `Your ${c.amount} ${c.asset} stake is on-chain in escrow and the dare is live. Keep the evidence handy - you submit the proof before the deadline.`}
                  </p>
                </div>
              ) : isConfirming ? (
                <div className="flex items-start gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-5 py-4">
                  <Loader2 className="mt-0.5 size-5 shrink-0 text-primary animate-spin" />
                  <p className="text-sm leading-relaxed text-foreground">
                    Payment sent. Confirming {c.amount} {c.asset} on the Nimiq
                    network. The dare goes live once the deposit is seen in
                    escrow.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="flex items-start gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/5 px-5 py-4">
                    <Wallet className="mt-0.5 size-5 shrink-0 text-amber-300" />
                    <p className="text-sm leading-relaxed text-foreground">
                      {c.step === "funding"
                        ? `Confirm the ${c.amount} ${c.asset} payment in the Nimiq Pay sheet. The dare only goes live once the deposit is seen on-chain.`
                        : `Your dare is staged but not funded yet. Confirm ${c.amount} ${c.asset} in Nimiq Pay to lock the stake into escrow.`}
                    </p>
                  </div>
                  {c.error && (
                    <p className="font-mono text-[11px] text-red-400">
                      ERR: {c.error}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      onClick={() => {
                        const retryMessage = `nimdares:fund:${Date.now()}:${c.dareId}`;
                        void wallet
                          .signMessage(retryMessage)
                          .then((retrySig) => {
                            if (!retrySig) {
                              setState({
                                ...c,
                                step: "failed",
                                error:
                                  "wallet signature failed or was rejected",
                              });
                              return;
                            }
                            const retryAuth = `Nimiq ${retrySig.publicKey}:${retrySig.signature}:${base64UrlEncode(retryMessage)}`;
                            void (c.paymentSent
                              ? confirmFunding(c, retryAuth)
                              : stakeAndFund(c, retryAuth));
                          });
                      }}
                      disabled={
                        isConfirming || !c.escrowAddress || !c.escrowConfigured
                      }
                    >
                      <Wallet className="size-4" />
                      {isConfirming
                        ? "Confirming on-chain…"
                        : c.paymentSent
                          ? "Recheck escrow deposit"
                          : `Confirm ${c.amount} ${c.asset} in Pay`}
                      <ArrowRight className="size-4" />
                    </Button>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      &gt; signed by your Nimiq identity; escrow:{" "}
                      {c.escrowConfigured ? "hot" : "unconfigured"}
                    </p>
                  </div>
                  {c.escrowConfigured && c.escrowAddress && (
                    <div className="border-t border-border pt-4">
                      <button
                        type="button"
                        className="flex w-full items-start gap-2 rounded-lg px-1 py-0.5 text-left hover:bg-muted/20"
                        onClick={() =>
                          void navigator.clipboard
                            ?.writeText(c.escrowAddress!)
                            .catch(() => {})
                        }
                      >
                        <Copy className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        <span className="flex flex-col gap-1">
                          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                            Escrow address (tap to copy · manual fallback)
                          </span>
                          <span className="break-all font-mono text-xs text-foreground/80">
                            {c.escrowAddress}
                          </span>
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              )}
              {isRoom && c.roomCode && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3">
                  <p className="flex-1 font-mono text-3xl font-semibold tracking-[0.3em] text-primary">
                    {c.roomCode}
                  </p>
                  <Button href={`/app/dare/${c.dareId}`}>
                    Enter lobby <ArrowRight className="size-4" />
                  </Button>
                </div>
              )}
              <div className="flex flex-wrap gap-3">
                <Button href={`/app/dare/${c.dareId}`}>
                  {isPaid ? "Open the dare" : "Open in lobby"}{" "}
                  <ArrowRight className="size-4" />
                </Button>
                <Button href="/app">
                  <ArrowLeft className="size-4" /> Back to console
                </Button>
              </div>
            </div>
          </HudPanel>
        </motion.div>
      </div>
    );
  }

  const disabled = wallet.status !== "ready";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] md:text-5xl">
          New dare
        </h1>
        <p className="mt-3 max-w-xl text-muted-foreground">
          Define the commitment, stake on it, and choose how the verdict is
          reached.
        </p>
      </motion.div>

      {disabled && (
        <HudPanel label="Wallet" icon={<Wallet className="size-3.5" />}>
          <p className="font-mono text-sm text-muted-foreground">
            &gt; dares can only be created from inside Nimiq Pay. Development
            mode: {wallet.address ?? "no host, no address"}.
          </p>
        </HudPanel>
      )}

      {/* commitment */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <HudPanel label="01 · Commitment" icon={<Plus className="size-3.5" />}>
          <div className="flex flex-col gap-5">
            <Field label="Title">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Run a 10k in under 60 minutes"
                className="hud-input"
                maxLength={80}
              />
            </Field>
            <Field label="Details">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What exactly are you committing to, and why does it matter?"
                className="hud-input min-h-24 resize-y"
                maxLength={2000}
              />
            </Field>
            <Field label="Acceptance criteria">
              <textarea
                value={criteria}
                onChange={(e) => setCriteria(e.target.value)}
                placeholder="What must the screenshot show? e.g. 'GitHub PR page, merged, my username, merged after Mar 1'."
                className="hud-input min-h-24 resize-y"
                maxLength={2000}
              />
            </Field>
          </div>
        </HudPanel>
      </motion.div>

      {/* mode */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <HudPanel label="02 · Mode" icon={<Users className="size-3.5" />}>
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2 md:flex-row">
              {MODES.map((m) => {
                const Icon = m.icon;
                const active = mode === m.mode;
                return (
                  <button
                    key={m.mode}
                    onClick={() => setMode(m.mode)}
                    className={`flex flex-1 items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all ${
                      active
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-muted-foreground/40"
                    }`}
                  >
                    <Icon
                      className={`size-4 ${active ? "text-primary" : "text-muted-foreground"}`}
                    />
                    <span className="flex flex-col gap-0.5">
                      <span
                        className={`text-sm capitalize ${active ? "text-foreground" : "text-muted-foreground"}`}
                      >
                        {m.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {m.hint}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            {mode !== "solo" && (
              <Field label="Max players">
                <input
                  type="number"
                  min="2"
                  max="50"
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  className="hud-input max-w-40"
                />
              </Field>
            )}
            <p className="font-mono text-[11px] text-muted-foreground">
              &gt;{" "}
              {mode === "solo" &&
                "solo dares are private to you and fund straight from your wallet via Nimiq Pay"}
              {mode === "team" &&
                "team rooms are private; each member joins with the invite code"}
              {mode === "arena" &&
                "arena rooms are public and appear in the arena feed for anyone to join"}
            </p>
          </div>
        </HudPanel>
      </motion.div>

      {/* stake */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <HudPanel label="03 · Stake" icon={<Wallet className="size-3.5" />}>
          <div className="flex flex-col gap-5">
            <div className="flex gap-2">
              {(["NIM", "USDT"] as Asset[]).map((a) => (
                <button
                  key={a}
                  onClick={() => setAsset(a)}
                  className={`rounded-xl border px-4 py-2.5 font-mono text-sm transition-all ${
                    asset === a
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-muted-foreground/40"
                  }`}
                >
                  {a}
                </button>
              ))}
              {asset === "USDT" && (
                <span className="font-mono text-[10px] text-amber-300/80">
                  manual funding only
                </span>
              )}
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <Field label={`Amount (${asset})`}>
                <input
                  type="number"
                  min="0.01"
                  step={asset === "NIM" ? "0.01" : "0.1"}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="hud-input"
                />
              </Field>
              <Field label="Deadline">
                <input
                  type="datetime-local"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  className="hud-input"
                />
              </Field>
            </div>
            <p className="font-mono text-[11px] text-muted-foreground">
              &gt; deadline must be within 90 days. Late or missing proof is
              slashed into the slash pool.
            </p>
          </div>
        </HudPanel>
      </motion.div>

      {/* verifier */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <HudPanel
          label="04 · Verifier"
          icon={<CircleAlert className="size-3.5" />}
        >
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3">
              <ImageIcon className="mt-0.5 size-4 shrink-0 text-primary" />
              <div className="flex flex-col gap-1">
                <span className="text-sm text-foreground">Screenshot proof</span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  You submit a screenshot before the deadline and an AI judge
                  rules on it against your acceptance criteria.
                </span>
              </div>
            </div>
            <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
              &gt; a commit history, a run summary, a receipt - anything works as
              long as the criteria above say what the screenshot has to show.
            </p>
          </div>
        </HudPanel>
      </motion.div>

      {state.phase === "error" && (
        <HudPanel label="Error" icon={<CircleAlert className="size-3.5" />}>
          <p className="font-mono text-sm text-red-400">ERR: {state.message}</p>
        </HudPanel>
      )}

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-wrap items-center justify-between gap-4"
      >
        <div className="flex items-center gap-3">
          <StatusPill
            label={disabled ? "NO WALLET" : "SIGN + PAY"}
            tone={
              disabled
                ? "neutral"
                : wallet.status === "signing" || state.phase === "signing"
                  ? "live"
                  : "neutral"
            }
            live={!disabled}
          />
          <p className="font-mono text-[11px] text-muted-foreground">
            {wallet.status === "signing"
              ? "host signing…"
              : "sign · stake · locked on-chain"}
          </p>
        </div>
        <Button
          onClick={handleCreate}
          disabled={
            disabled ||
            state.phase === "signing" ||
            state.phase === "submitting"
          }
        >
          {state.phase === "signing" || state.phase === "submitting"
            ? "Signing…"
            : `Stake ${amount} ${asset} & create`}
          <ArrowRight className="size-4" />
        </Button>
      </motion.div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <div className="mt-2">{children}</div>
    </label>
  );
}
