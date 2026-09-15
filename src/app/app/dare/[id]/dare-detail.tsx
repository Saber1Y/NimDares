"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowLeft,
  Copy,
  ImageIcon,
  GitBranch,
  Bike,
  Check,
  ScanLine,
  Swords,
  Hourglass,
  Users,
  KeyRound,
  Coins,
  Loader2,
} from "lucide-react";
import { useNimiqWallet } from "@/components/nimiq-provider";
import { HudPanel } from "@/components/ui/hud-panel";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Dare, Participant } from "@/lib/types";
import { NIM_MAX_TX_DATA_BYTES, MAX_PROOF_ATTEMPTS } from "@/lib/config";
import { formatProviderError } from "@/lib/errors";

type SubmitState =
  | { phase: "idle"; error: string | null }
  | { phase: "capturing" }
  | { phase: "signing" }
  | { phase: "submitting" }
  | { phase: "done"; message: string };

function formatAmount(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatDeadline(iso: string): string {
  const d = new Date(iso);
  const ms = d.getTime() - Date.now();
  const when = d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  if (ms > 0) {
    const days = Math.floor(ms / 86_400_000);
    const hrs = Math.floor((ms % 86_400_000) / 3_600_000);
    return ms > 86_400_000 ? `${when} · ${days}d ${hrs}h left` : `${when} · ${hrs}h left`;
  }
  return `${when} · expired`;
}

function base64UrlEncode(s: string): string {
  const b64 = btoa(unescape(encodeURIComponent(s)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}


interface ProofOutcome {
  verdict?: string;
  reason?: string;
  attemptsLeft?: number;
  payout?: { status?: string; txHash?: string } | null;
}

/** Turns a ruling into one line the user can act on. */
function proofMessage(data: ProofOutcome, pooled: boolean): string {
  const left =
    typeof data.attemptsLeft === "number" && data.attemptsLeft > 0 && data.verdict !== "VALID"
      ? ` ${data.attemptsLeft} ${data.attemptsLeft === 1 ? "attempt" : "attempts"} left.`
      : "";
  switch (data.verdict) {
    case "VALID":
      if (pooled) return "verified - your share is paid when the dare ends";
      return data.payout?.status === "SETTLED"
        ? "verified - your stake has been returned"
        : "verified - returning your stake";
    case "AMBIGUOUS":
      return `inconclusive: ${data.reason ?? "the judge could not tell"}${left}`;
    case "INVALID":
      return `rejected: ${data.reason ?? "the proof did not hold up"}${left}`;
    case "UNAVAILABLE":
      return "the judge is offline; your proof is stored and will be ruled on later";
    default:
      return "proof submitted";
  }
}

function isPastDeadline(iso: string): boolean {
  return new Date(iso).getTime() <= Date.now();
}

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export default function DareDetail({ id, initial }: { id: string; initial: Dare | null }) {
  const wallet = useNimiqWallet();
  const { getAccountSnapshots, balances, status: walletStatus } = wallet;
  const [dare, setDare] = useState<Dare | null>(initial);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [missing, setMissing] = useState(false);
  const [proofLink, setProofLink] = useState("");
  const [submit, setSubmit] = useState<SubmitState>({ phase: "idle", error: null });
  const [copied, setCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [funding, setFunding] = useState<{ phase: "idle" } | { phase: "sending"; serialized: string | null }>(
    { phase: "idle" }
  );
  const [joining, setJoining] = useState(false);
  // Funding has its own note, rendered beside the fund button. Sharing `submit`
  // pushed payment status down into the proof panel at the foot of the page.
  const [fundingNote, setFundingNote] = useState<
    { tone: "error" | "ok"; text: string } | null
  >(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (dare) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/dares/${id}`, { cache: "no-store" });
        if (cancelled) return;
        if (res.status === 404) {
          setMissing(true);
          return;
        }
        if (!res.ok) return;
        const data = await res.json();
        if (data.dare) setDare(data.dare);
        if (Array.isArray(data.participants)) setParticipants(data.participants);
      } catch {
        /* keep last known state */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, dare]);

  useEffect(() => {
    if (walletStatus !== "ready") return;
    // Warms the balance so the fund button can say whether the stake is
    // affordable before the user taps it. Cached in the provider for 10s.
    void getAccountSnapshots();
  }, [walletStatus, getAccountSnapshots]);

  useEffect(() => {
    if (!dare) return;
    const load = async () => {
      try {
        const res = await fetch(`/api/dares/${dare.id}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (data.dare) {
          const next = data.dare as Dare;
          setDare((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
        }
        if (Array.isArray(data.participants)) setParticipants(data.participants);
      } catch {
        /* keep last known state */
      }
    };
    void load();
    const timer = setInterval(load, 6000);
    return () => clearInterval(timer);
  }, [dare]);

  if (missing) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 py-24 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl border border-border bg-muted/30">
          <Hourglass className="size-6 text-muted-foreground" />
        </div>
        <div>
          <p className="font-mono text-[12px] uppercase tracking-[0.16em] text-foreground">
            DARE NOT FOUND
          </p>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            The ledger has no record for this dare id. It may live on a different
            store than this deployment.
          </p>
        </div>
        <Button href="/app">Back to console</Button>
      </div>
    );
  }

  if (!dare) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-xl" />
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <HudPanel label="Details" icon={<Swords className="size-3.5" />}>
          <div className="flex flex-col gap-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <div className="grid gap-4 pt-4 md:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="border-t border-border pt-3">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="mt-2 h-5 w-24" />
                </div>
              ))}
            </div>
          </div>
        </HudPanel>
        <HudPanel label="Funding" icon={<Coins className="size-3.5" />}>
          <div className="flex flex-col gap-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-10 w-40" />
          </div>
        </HudPanel>
        <HudPanel label="Acceptance criteria" icon={<ScanLine className="size-3.5" />}>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-2/3" />
        </HudPanel>
      </div>
    );
  }

  const cur = dare;
  const isRoom = cur.maxCapacity > 1;
  const mySeat = isRoom ? participants.find((p) => p.userAddress === wallet.address) ?? null : null;
  const attemptsUsed = isRoom ? (mySeat?.proofAttempts ?? 0) : cur.proofAttempts;
  const ruledValid = isRoom
    ? mySeat?.aiVerdict === "VALID"
    : cur.verifierResult?.status === "VALID";
  const attemptsLeft = ruledValid ? 0 : Math.max(0, MAX_PROOF_ATTEMPTS - attemptsUsed);
  const pastDeadline = isPastDeadline(cur.deadline);
  // Same affordability rule as the create page: the highest single account,
  // since a stake is paid from one account. An unreadable balance stays null
  // and never blocks.
  const availableNim =
    cur.asset === "NIM" && balances.length > 0
      ? balances.reduce((best, snap) => Math.max(best, snap.balanceNim), 0)
      : null;
  const insufficientFunds = availableNim !== null && cur.amount > availableNim;
  const shortfallNim = insufficientFunds ? cur.amount - (availableNim ?? 0) : 0;
  const roomOpen = cur.status === "LOBBY" || cur.status === "ACTIVE";
  const canJoin =
    isRoom &&
    roomOpen &&
    !mySeat &&
    participants.length < cur.maxCapacity &&
    // eslint-disable-next-line react-hooks/purity -- deadline comparison is stable per render
    new Date(cur.deadline).getTime() > Date.now();

  const tone =
    cur.status === "WON"
      ? "success"
      : cur.status === "LOST"
        ? "failed"
        : cur.status === "ACTIVE" || cur.status === "PENDING_FUNDING" || cur.status === "LOBBY"
          ? "live"
          : "neutral";

  const VerifierIcon = cur.verifierKind === "STRAVA" ? Bike : cur.verifierKind === "GITHUB" ? GitBranch : ImageIcon;

  async function fundFromWallet() {
    const recip = cur.escrow?.address;
    if (!recip) {
      setFunding({ phase: "idle" });
      return;
    }
    if (isRoom && !mySeat) return;
    if (!wallet.provider || wallet.status !== "ready") {
      setFunding({ phase: "idle" });
      return;
    }
    if (insufficientFunds) {
      setFundingNote({
        tone: "error",
        text: `insufficient balance: ${availableNim?.toFixed(2)} NIM available, ${shortfallNim.toFixed(2)} NIM short`,
      });
      return;
    }
    // Reference the escrow scanner resolves the stake from; stays inside the
    // 64-byte recipient-data cap.
    const memo = `nimdares:${isRoom && mySeat ? mySeat.id : cur.id}`;
    if (new TextEncoder().encode(memo).length > NIM_MAX_TX_DATA_BYTES) {
      setFundingNote({ tone: "error", text: "funding reference is too long for a Nimiq transaction" });
      return;
    }

    // Signed first so the payment dialog is the last thing the user confirms.
    const message = `nimdares:fund:${cur.id}:${Date.now()}`;
    const sig = await wallet.signMessage(message);
    if (!sig) {
      setFundingNote({ tone: "error", text: "funding rejected: signature was declined" });
      return;
    }
    const authHeader = `Nimiq ${sig.publicKey}:${sig.signature}:${base64UrlEncode(message)}`;

    setFundingNote(null);
    setFunding({ phase: "sending", serialized: null });

    // The same call the create flow uses. Fee and validity window are left to
    // the wallet: supplying our own validityStartHeight here is what the host
    // was rejecting as an invalidated transaction.
    const res = await wallet.sendPayTransaction(recip, Math.round(cur.amount * 100_000), memo);
    const sent = res.ok;
    if (!res.ok && !res.indeterminate) {
      // Declined in Nimiq Pay: the stake simply stays unfunded.
      setFunding({ phase: "idle" });
      setFundingNote({
        tone: "error",
        text: `funding rejected: ${res.error ?? "the payment was declined"}`,
      });
      return;
    }
    const txRef = res.txRef ?? null;
    setFunding({ phase: "sending", serialized: txRef });

    try {
      const confirm = await fetch(`/api/dares/${cur.id}/fund`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: authHeader },
        body: JSON.stringify({
          asset: "NIM",
          txRef: txRef ?? undefined,
          participantId: isRoom && mySeat ? mySeat.id : undefined,
        }),
      });
      const data = (await confirm.json()) as { ok?: boolean; status?: string; error?: string };
      setFunding({ phase: "idle" });
      if (!confirm.ok || !data.ok) {
        setFundingNote({ tone: "error", text: data.error ?? "could not confirm the escrow deposit" });
        return;
      }
      if (data.status === "funded") {
        setFundingNote({ tone: "ok", text: "stake is in escrow - the dare is live" });
      } else if (sent) {
        // Broadcast but not in a block yet; the refresh loop settles it.
        setFundingNote({ tone: "ok", text: "payment sent - confirming on the Nimiq network" });
      } else {
        // The wallet never confirmed and escrow has seen nothing: claiming the
        // payment was sent here is what made a failed transfer look successful.
        setFundingNote({
          tone: "error",
          text: `${res.error ?? "the wallet did not confirm the payment"} - nothing has reached escrow`,
        });
      }
      const refresh = await fetch(`/api/dares/${cur.id}`, { cache: "no-store" });
      const rd = await refresh.json();
      if (rd.dare) setDare(rd.dare as Dare);
      if (Array.isArray(rd.participants)) setParticipants(rd.participants);
      void getAccountSnapshots(true);
    } catch (e) {
      setFunding({ phase: "idle" });
      setFundingNote({ tone: "error", text: formatProviderError(e) });
    }
  }

  async function joinRoom() {
    if (!wallet.address || wallet.status !== "ready") {
      setSubmit({ phase: "idle", error: "wallet not connected; cannot sign the room join" });
      return;
    }
    const message = `nimdares:join:${cur.id}:${Date.now()}`;
    setJoining(true);
    const sig = await wallet.signMessage(message);
    if (!sig) {
      setJoining(false);
      setSubmit({ phase: "idle", error: "wallet signature failed or was rejected" });
      return;
    }
    const authHeader = `Nimiq ${sig.publicKey}:${sig.signature}:${base64UrlEncode(message)}`;
    try {
      const res = await fetch(`/api/dares/${cur.id}/join`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: authHeader },
        body: JSON.stringify({ roomCode: cur.roomCode ?? undefined }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setJoining(false);
        setSubmit({ phase: "idle", error: data?.error ?? `HTTP ${res.status}` });
        return;
      }
      setJoining(false);
      setSubmit({ phase: "done", message: "seat reserved - fund it to take the chair" });
      const refresh = await fetch(`/api/dares/${cur.id}`, { cache: "no-store" });
      const rd = await refresh.json();
      if (Array.isArray(rd.participants)) setParticipants(rd.participants);
    } catch (e) {
      setJoining(false);
      setSubmit({ phase: "idle", error: formatProviderError(e) });
    }
  }

  async function submitProof(image?: string) {
    if (!wallet.address || wallet.status !== "ready") {
      setSubmit({ phase: "idle", error: "wallet not connected; cannot sign the proof" });
      return;
    }
    const isVision = cur.verifierKind === "VISION";
    if (isVision && !image) {
      setSubmit({ phase: "idle", error: "capture a screenshot first" });
      return;
    }
    if (!isVision && !proofLink.trim()) {
      setSubmit({ phase: "idle", error: "provide the verifier link first" });
      return;
    }

    const dareId = cur.id;
    const message = `nimdares:proof:${dareId}:${Date.now()}`;
    setSubmit({ phase: "signing" });
    const sig = await wallet.signMessage(message);
    if (!sig) {
      setSubmit({ phase: "idle", error: "wallet signature failed or was rejected" });
      return;
    }

    setSubmit({ phase: "submitting" });
    const authHeader = `Nimiq ${sig.publicKey}:${sig.signature}:${base64UrlEncode(message)}`;
    try {
      const body = isVision && image ? { proofImage: image } : { proofLink: proofLink.trim() };
      const res = await fetch(`/api/dares/${dareId}/proof`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: authHeader },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setSubmit({ phase: "idle", error: data?.error ?? `HTTP ${res.status}` });
        return;
      }
      setSubmit({ phase: "done", message: proofMessage(data, false) });
      if (data.dare) setDare(data.dare);
    } catch (e) {
      setSubmit({ phase: "idle", error: formatProviderError(e) });
    }
  }

  async function submitSeatProof(image?: string) {
    if (!mySeat) return;
    if (!wallet.address || wallet.status !== "ready") {
      setSubmit({ phase: "idle", error: "wallet not connected; cannot sign the proof" });
      return;
    }
    const isVision = cur.verifierKind === "VISION";
    if (isVision && !image) {
      setSubmit({ phase: "idle", error: "capture a screenshot first" });
      return;
    }
    if (!isVision && !proofLink.trim()) {
      setSubmit({ phase: "idle", error: "provide the verifier link first" });
      return;
    }

    const message = `nimdares:seatproof:${cur.id}:${mySeat.id}:${Date.now()}`;
    setSubmit({ phase: "signing" });
    const sig = await wallet.signMessage(message);
    if (!sig) {
      setSubmit({ phase: "idle", error: "wallet signature failed or was rejected" });
      return;
    }

    setSubmit({ phase: "submitting" });
    const authHeader = `Nimiq ${sig.publicKey}:${sig.signature}:${base64UrlEncode(message)}`;
    try {
      const body = isVision && image ? { proofImage: image } : { proofLink: proofLink.trim() };
      const res = await fetch(`/api/dares/${cur.id}/seats/${mySeat.id}/proof`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: authHeader },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setSubmit({ phase: "idle", error: data?.error ?? `HTTP ${res.status}` });
        return;
      }
      setSubmit({ phase: "done", message: proofMessage(data, true) });
      const refresh = await fetch(`/api/dares/${cur.id}`, { cache: "no-store" });
      const rd = await refresh.json();
      if (Array.isArray(rd.participants)) setParticipants(rd.participants);
    } catch (e) {
      setSubmit({ phase: "idle", error: formatProviderError(e) });
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSubmit({ phase: "capturing" });
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      if (dataUrl.length > 6_000_000) {
        setSubmit({ phase: "idle", error: "image too large; keep it under ~4.5 MB" });
        return;
      }
      setSubmit({ phase: "idle", error: null });
      void submitSeatProof(dataUrl);
    };
    reader.onerror = () => setSubmit({ phase: "idle", error: "could not read image" });
    reader.readAsDataURL(file);
  }

  const escrowShown =
    cur.status === "PENDING_FUNDING" && (cur.ownerAddress === wallet.address || wallet.status !== "ready");
  const isConfirming = cur.status === "PENDING_FUNDING" && cur.funded === false;
  const seatNeedsFunds = mySeat && !mySeat.funded && roomOpen && cur.escrow;

  const seatTone = (p: Participant) =>
    p.aiVerdict === "VALID" ? "success" : p.aiVerdict === "INVALID" ? "failed" : p.funded ? "live" : "neutral";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <Button href="/app" variant="ghost" className="px-0 text-muted-foreground">
          <ArrowLeft className="size-4" /> Console
        </Button>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <StatusPill label={cur.status} tone={tone} live={tone === "live"} />
          {isRoom && <StatusPill label={cur.isPrivate ? "TEAM ROOM" : "ARENA ROOM"} tone="neutral" />}
        </div>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] md:text-5xl">
          {cur.title}
        </h1>
        <p className="mt-3 max-w-xl leading-relaxed text-muted-foreground">{cur.description}</p>
      </motion.div>

      {/* status strip */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <HudPanel label="Status" icon={<Swords className="size-3.5" />}>
          <div className="grid gap-6 md:grid-cols-4">
            <Stat label="Stake" value={`${formatAmount(cur.amount)} ${cur.asset}`} mono />
            <Stat label="Deadline" value={formatDeadline(cur.deadline)} mono />
            <Stat label="Verifier" value={cur.verifierKind} mono />
            <Stat
              label={isRoom ? "Room" : "Owner"}
              value={isRoom ? `${participants.length} / ${cur.maxCapacity} seated` : shortAddr(cur.ownerAddress)}
              mono
            />
          </div>
        </HudPanel>
      </motion.div>

      {/* lobby */}
      {isRoom && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <HudPanel
            label="Lobby"
            icon={<Users className="size-3.5" />}
            badge={`${participants.length}/${cur.maxCapacity}`}
          >
            <div className="flex flex-col gap-3">
              {cur.roomCode && cur.isPrivate && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3">
                  <KeyRound className="size-4 text-muted-foreground" />
                  <p className="flex-1 font-mono text-2xl font-semibold tracking-[0.3em] text-primary">
                    {cur.roomCode}
                  </p>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(cur.roomCode ?? "").catch(() => {});
                      setCodeCopied(true);
                      setTimeout(() => setCodeCopied(false), 1500);
                    }}
                    className="text-muted-foreground transition-colors hover:text-primary"
                  >
                    <Copy className="size-4" />
                  </button>
                  {codeCopied && <StatusPill label="COPIED" tone="live" live />}
                </div>
              )}
              <div className="flex flex-col divide-y divide-border">
                {participants.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30 font-mono text-[10px] text-primary">
                        {p.userAddress.slice(-2).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm text-foreground">
                          {p.userAddress === wallet.address ? `${shortAddr(p.userAddress)} (you)` : shortAddr(p.userAddress)}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {p.funded ? `funded · memo credited` : "seat reserved · awaiting funding"}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {p.aiVerdict !== "WAITING" && (
                        <StatusPill
                          label={p.aiVerdict}
                          tone={
                            p.aiVerdict === "VALID"
                              ? "success"
                              : p.aiVerdict === "INVALID"
                                ? "failed"
                                : "neutral"
                          }
                        />
                      )}
                      <StatusPill
                        label={p.funded ? "FUNDED" : p.proofImageUrl || p.proofLink ? "PROOF IN" : "UNFUNDED"}
                        tone={seatTone(p)}
                      />
                    </div>
                  </div>
                ))}
                {participants.length === 0 && (
                  <p className="py-4 font-mono text-sm text-muted-foreground">&gt; lobby empty</p>
                )}
              </div>
              {canJoin && (
                <div className="border-t border-border pt-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <Button onClick={() => void joinRoom()} disabled={joining || wallet.status !== "ready"}>
                      {joining ? "Signing…" : "Join room"}
                      <Users className="size-4" />
                    </Button>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      &gt; stake {formatAmount(cur.amount)} {cur.asset} into your chair once you join
                    </p>
                  </div>
                  {submit.phase === "idle" && submit.error && (
                    <p className="mt-3 font-mono text-[11px] text-red-400">ERR: {submit.error}</p>
                  )}
                  {submit.phase === "done" && submit.message.startsWith("seat reserved") && (
                    <p className="mt-3 font-mono text-[11px] text-primary">OK: {submit.message}</p>
                  )}
                </div>
              )}
            </div>
          </HudPanel>
        </motion.div>
      )}

      {/* escrow deposit guidance */}
      {(escrowShown || (isRoom && seatNeedsFunds)) && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <HudPanel label="Funding" icon={<Coins className="size-3.5" />} badge={isConfirming ? "CONFIRMING" : "PENDING"}>
            <div className="flex flex-col gap-4">
              {isConfirming && (
                <div className="flex items-start gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-5 py-4">
                  <Loader2 className="mt-0.5 size-5 shrink-0 text-primary animate-spin" />
                  <p className="text-sm leading-relaxed text-foreground">
                    Payment sent. Confirming on the Nimiq network. The dare goes live once the deposit is seen in escrow.
                  </p>
                </div>
              )}
              <p className="text-sm leading-relaxed text-muted-foreground">
                {isRoom ? (
                  <>
                    Fund your seat with{" "}
                    <span className="font-mono text-primary">{formatAmount(cur.amount)} {cur.asset}</span>{" "}
                    carrying the per-seat memo below. The ledger credits your chair from the
                    memo when the reconciliation sweeps the escrow.
                  </>
                ) : (
                  <>
                    Send <span className="font-mono text-primary">{formatAmount(cur.amount)} {cur.asset}</span> to
                    the escrow address. The sweep places the dare once the deposit is observed
                    on-chain.
                  </>
                )}
              </p>
              <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3">
                <p className="flex-1 break-all font-mono text-sm text-foreground">
                  {cur.escrow?.address ?? "ESCROW NOT CONFIGURED"}
                </p>
                {cur.escrow?.address && (
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(cur.escrow?.address ?? "").catch(() => {});
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    className="text-muted-foreground transition-colors hover:text-primary"
                  >
                    <Copy className="size-4" />
                  </button>
                )}
              </div>
              {isRoom && mySeat && (
                <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3">
                  <p className="flex-1 break-all font-mono text-xs text-muted-foreground">
                    memo: <span className="text-primary">nimdares:{mySeat.id}</span>
                  </p>
                </div>
              )}
              {copied && <StatusPill label="COPIED" tone="live" live />}
              {cur.asset === "NIM" &&
                wallet.provider &&
                // "signing" is the wallet sheet being open: keep the panel
                // mounted through it, or the progress and result vanish
                // exactly while the payment is happening.
                (walletStatus === "ready" || walletStatus === "signing") && (
                <div className="flex flex-wrap items-center gap-4 border-t border-border pt-4">
                  <Button
                    onClick={() => void fundFromWallet()}
                    disabled={
                      funding.phase === "sending" || insufficientFunds || (isRoom && !mySeat)
                    }
                  >
                    {funding.phase === "sending"
                      ? "Sending…"
                      : insufficientFunds
                        ? "Insufficient NIM balance"
                        : `Fund ${formatAmount(cur.amount)} NIM from wallet`}
                  </Button>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    &gt; signed by the Pay host; the sweep auto-activates once the deposit lands
                  </p>
                  <div className="w-full">
                    {insufficientFunds && (
                      <p className="font-mono text-[11px] text-red-400">
                        &gt; insufficient balance · {availableNim?.toFixed(2)} NIM available,{" "}
                        {shortfallNim.toFixed(2)} NIM short
                      </p>
                    )}
                    {funding.phase === "sending" && funding.serialized && (
                      <p className="font-mono text-[11px] text-primary">
                        TX SENT TO PAY HOST - {funding.serialized.slice(0, 40)}…
                      </p>
                    )}
                    {fundingNote && (
                      <p
                        className={`font-mono text-[11px] ${
                          fundingNote.tone === "error" ? "text-red-400" : "text-primary"
                        }`}
                      >
                        {fundingNote.tone === "error" ? "ERR: " : "OK: "}
                        {fundingNote.text}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </HudPanel>
        </motion.div>
      )}

      {/* criteria */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <HudPanel label="Acceptance criteria" icon={<ScanLine className="size-3.5" />}>
          <p className="text-sm leading-relaxed text-foreground">{cur.criteria}</p>
          {cur.verifierLink && (
            <p className="mt-4 font-mono text-[11px] text-muted-foreground">
              verifier input: <span className="text-primary">{cur.verifierLink}</span>
            </p>
          )}
        </HudPanel>
      </motion.div>

      {/* verdict */}
      {cur.verifierResult && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <HudPanel
            label="Verdict"
            icon={<Check className="size-3.5" />}
            badge={cur.verifierResult.status}
          >
            <p className="font-mono text-sm leading-relaxed text-foreground">
              {cur.verifierResult.reason}
            </p>
            {typeof cur.verifierResult.confidence === "number" && (
              <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                completion score:{" "}
                <span className="text-primary">{cur.verifierResult.confidence}/100</span>
                {cur.verifierResult.source ? ` · ${cur.verifierResult.source}` : ""}
              </p>
            )}
            {cur.verifierResult.observations && (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                observed: {cur.verifierResult.observations}
              </p>
            )}
            {cur.verifierResult.status === "AMBIGUOUS" && (
              <p className="mt-3 text-xs leading-relaxed text-amber-300">
                Inconclusive. Your stake is returned if the deadline passes on
                this ruling
                {attemptsLeft > 0
                  ? ` - you can still submit a clearer screenshot (${attemptsLeft} ${attemptsLeft === 1 ? "attempt" : "attempts"} left).`
                  : "."}
              </p>
            )}
            {cur.verifierResult.status === "INVALID" && attemptsLeft > 0 && (
              <p className="mt-3 text-xs leading-relaxed text-amber-300">
                {attemptsLeft} {attemptsLeft === 1 ? "attempt" : "attempts"} left
                - you can submit a different screenshot before the deadline.
              </p>
            )}
            {cur.payoutStatus && (
              <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                payout: <span className="text-primary">{cur.payoutStatus}</span>
                {cur.payoutTxHash && ` · ${cur.payoutTxHash.slice(0, 18)}…`}
              </p>
            )}
          </HudPanel>
        </motion.div>
      )}

      {/* proof submission */}
      {(cur.status === "ACTIVE" ||
        cur.status === "PENDING_FUNDING" ||
        (cur.status === "SUBMITTED" && attemptsLeft > 0 && !pastDeadline)) &&
        !isRoom && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <HudPanel label="Submit proof" icon={<VerifierIcon className="size-3.5" />}>
            <div className="flex flex-col gap-5">
              {cur.verifierKind === "VISION" ? (
                <>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Attach the evidence screenshot before the deadline. The AI
                    judge rules on it straight away, so you can replace it while
                    the dare is open.
                    {isRoom
                      ? " Shares are paid out when the dare ends."
                      : " A verified proof returns your stake immediately."}
                    {attemptsLeft > 0 &&
                      ` ${attemptsLeft} of ${MAX_PROOF_ATTEMPTS} ${attemptsLeft === 1 ? "attempt" : "attempts"} left.`}
                  </p>
                  {cur.evidenceSpec && (
                    <div className="rounded-xl border border-border bg-muted/20 px-4 py-3">
                      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        Your screenshot must show
                      </p>
                      <ul className="mt-2 flex flex-col gap-1.5">
                        {cur.evidenceSpec.requirements.map((r, i) => (
                          <li key={i} className="flex gap-2 text-xs leading-relaxed text-foreground/80">
                            <span className="text-primary">{i + 1}.</span>
                            <span>{r}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={onFile}
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      onClick={() => fileRef.current?.click()}
                      disabled={wallet.status !== "ready" || submit.phase === "signing" || submit.phase === "submitting" || submit.phase === "capturing"}
                    >
                      {submit.phase === "capturing" ? "Reading…" : "Attach screenshot"}
                      <ImageIcon className="size-4" />
                    </Button>
                    {cur.proofImageUrl && (
                      <StatusPill label="PROOF ON LEDGER" tone="neutral" />
                    )}
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-4">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Link your {cur.verifierKind === "GITHUB" ? "GitHub commit activity" : "Strava activity"} as proof.
                  </p>
                  <input
                    value={proofLink}
                    onChange={(e) => setProofLink(e.target.value)}
                    placeholder={cur.verifierKind === "GITHUB" ? "https://github.com/user" : "https://www.strava.com/activities/…"}
                    className="hud-input"
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      onClick={() => void submitProof()}
                      disabled={wallet.status !== "ready" || submit.phase === "signing" || submit.phase === "submitting" || !proofLink.trim()}
                    >
                      {submit.phase === "signing" ? "Signing…" : submit.phase === "submitting" ? "Submitting…" : "Submit proof"}
                    </Button>
                  </div>
                </div>
              )}
              {submit.phase === "idle" && submit.error && (
                <p className="font-mono text-[11px] text-red-400">ERR: {submit.error}</p>
              )}
              {submit.phase === "done" && (
                <p className="font-mono text-[11px] text-primary">OK: {submit.message}</p>
              )}
            </div>
          </HudPanel>
        </motion.div>
      )}

      {/* room seat proof */}
      {isRoom && mySeat && !pastDeadline && (cur.status === "LOBBY" || cur.status === "ACTIVE") && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <HudPanel
            label="Your seat proof"
            icon={<VerifierIcon className="size-3.5" />}
            badge={mySeat.funded ? "SEAT FUNDED" : "FUND SEAT FIRST"}
          >
            <div className="flex flex-col gap-5">
              {!mySeat.funded ? (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Your chair is reserved but not funded. Fund it above, then come back to attach
                  proof against the acceptance criteria.
                </p>
              ) : cur.verifierKind === "VISION" ? (
                <>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Attach the evidence screenshot before the deadline. The AI
                    judge rules on it straight away, so you can replace it while
                    the dare is open.
                    {isRoom
                      ? " Shares are paid out when the dare ends."
                      : " A verified proof returns your stake immediately."}
                    {attemptsLeft > 0 &&
                      ` ${attemptsLeft} of ${MAX_PROOF_ATTEMPTS} ${attemptsLeft === 1 ? "attempt" : "attempts"} left.`}
                  </p>
                  {cur.evidenceSpec && (
                    <div className="rounded-xl border border-border bg-muted/20 px-4 py-3">
                      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        Your screenshot must show
                      </p>
                      <ul className="mt-2 flex flex-col gap-1.5">
                        {cur.evidenceSpec.requirements.map((r, i) => (
                          <li key={i} className="flex gap-2 text-xs leading-relaxed text-foreground/80">
                            <span className="text-primary">{i + 1}.</span>
                            <span>{r}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={onFile}
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      onClick={() => fileRef.current?.click()}
                      disabled={wallet.status !== "ready" || submit.phase === "signing" || submit.phase === "submitting" || submit.phase === "capturing"}
                    >
                      {submit.phase === "capturing" ? "Reading…" : "Attach screenshot"}
                      <ImageIcon className="size-4" />
                    </Button>
                    {mySeat.proofImageUrl && (
                      <StatusPill label="PROOF ON LEDGER" tone="neutral" />
                    )}
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-4">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Link your {cur.verifierKind === "GITHUB" ? "GitHub commit activity" : "Strava activity"} as proof.
                  </p>
                  <input
                    value={proofLink}
                    onChange={(e) => setProofLink(e.target.value)}
                    placeholder={cur.verifierKind === "GITHUB" ? "https://github.com/user" : "https://www.strava.com/activities/…"}
                    className="hud-input"
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      onClick={() => void submitSeatProof()}
                      disabled={wallet.status !== "ready" || submit.phase === "signing" || submit.phase === "submitting" || !proofLink.trim()}
                    >
                      {submit.phase === "signing" ? "Signing…" : submit.phase === "submitting" ? "Submitting…" : "Submit proof"}
                    </Button>
                  </div>
                </div>
              )}
              {submit.phase === "idle" && submit.error && (
                <p className="font-mono text-[11px] text-red-400">ERR: {submit.error}</p>
              )}
              {submit.phase === "done" && !submit.message.startsWith("seat reserved") && (
                <p className="font-mono text-[11px] text-primary">OK: {submit.message}</p>
              )}
            </div>
          </HudPanel>
        </motion.div>
      )}
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="border-t border-border pt-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className={`mt-3 text-sm ${mono ? "font-mono" : ""} text-foreground`}>{value}</p>
    </div>
  );
}