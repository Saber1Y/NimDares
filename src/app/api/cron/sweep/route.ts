import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { adjudicateDare } from "@/lib/adjudicate";
import { payoutDare, settleRoom } from "@/lib/payout";
import { verdictToRecord } from "@/lib/proof-intake";
import { confirmNimFunding } from "@/lib/escrow/confirm";
import { retrySoloPayout, settleSoloWin } from "@/lib/settle";
import { retryVoidedRoomRefunds } from "@/lib/cancel";
import type { AdjudicationResult } from "@/lib/adjudicate";
import { getNimEscrowInfo, getNimCharityAddress } from "@/lib/escrow/nim";

/** Cap on settlement checks per sweep, so one run cannot storm the public RPC. */
const MAX_FUNDING_CHECKS = 25;

/**
 * Settles deposits that were never confirmed interactively - a manual transfer
 * to the escrow address, or a payment whose confirmation call never landed.
 * Each one is verified against the chain; escrow holding enough balance proves
 * nothing about who paid for which dare.
 */
async function fundPendingDares() {
  const store = getStore();
  const nimEscrow = getNimEscrowInfo();
  if (!nimEscrow.configured) return { funded: 0, skipped: 1 };

  const pending = (await store.listDares()).filter(
    (d) => d.asset === "NIM" && (d.status === "PENDING_FUNDING" || d.status === "LOBBY"),
  );
  let funded = 0;
  let skipped = 0;
  let checks = 0;

  for (const dare of pending) {
    if (checks >= MAX_FUNDING_CHECKS) {
      skipped += 1;
      continue;
    }
    if (dare.maxCapacity > 1) {
      const seats = (await store.listParticipants(dare.id)).filter((p) => !p.fundedAt);
      for (const seat of seats) {
        if (checks >= MAX_FUNDING_CHECKS) {
          skipped += 1;
          break;
        }
        checks += 1;
        const res = await confirmNimFunding(dare.id, { participantId: seat.id });
        if (res.status === "funded") funded += 1;
      }
      continue;
    }
    checks += 1;
    const res = await confirmNimFunding(dare.id);
    if (res.status === "funded") funded += 1;
  }

  return { funded, skipped };
}


/**
 * Scheduled runners issue a GET with `Authorization: Bearer $CRON_SECRET`;
 * manual calls use POST with the x-cron-secret header. Both land here.
 */
export async function GET(req: NextRequest) {
  return POST(req);
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.get("x-cron-secret");
    const bearer = req.headers.get("authorization");
    if (header !== secret && bearer !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }
  }

  const store = getStore();

  const stats = {
    scanned: 0,
    expired: 0,
    funded: 0,
    funding_skipped: 0,
    lost_no_proof: 0,
    adjudicated_valid: 0,
    adjudicated_invalid: 0,
    adjudicated_ambiguous: 0,
    refunded: 0,
    payouts_retried: 0,
    pool_fee_raw: "0",
    unresolved_unavailable: 0,
    payouts_settled: 0,
    payouts_pending: 0,
    payouts_failed: 0,
    rooms_settled: 0,
    rooms_pending: 0,
  };

  const funding = await fundPendingDares();
  stats.funded = funding.funded;
  stats.funding_skipped = funding.skipped;

  const dares = await store.listDares();
  const now = Date.now();
  stats.scanned = dares.length;

  for (const dare of dares) {
    // A solo dare paid out on verification can still have a failed transfer;
    // nothing else in this loop would ever look at it again.
    const retried = await retrySoloPayout(dare);
    if (retried) {
      if (retried.status === "SETTLED") stats.payouts_retried += 1;
      else stats.payouts_failed += 1;
      continue;
    }

    const roomRefundsRetried = await retryVoidedRoomRefunds(dare);
    if (roomRefundsRetried > 0) stats.payouts_retried += roomRefundsRetried;
    if (dare.status === "VOIDED") continue;

    const isFundedPreState = dare.status === "ACTIVE" || dare.status === "SUBMITTED";
    if (!isFundedPreState) {
      // Unfunded (Solo: PENDING_FUNDING, Room: LOBBY) dares expire as VOIDED once the deadline passes.
      const wasPendingFunding = dare.status === "PENDING_FUNDING" || dare.status === "LOBBY";
      if (wasPendingFunding && new Date(dare.deadline).getTime() <= now) {
        await store.updateDare(dare.id, {
          status: "VOIDED",
          verifierResult: { status: "INVALID", reason: "never funded before deadline" },
        });
        stats.expired += 1;
      }
      continue;
    }
    if (new Date(dare.deadline).getTime() > now) continue;
    stats.expired += 1;

    const chain = dare.asset === "NIM" ? "NIM" : "EVM";

    if (dare.maxCapacity > 1) {
      // Room settlement: adjudicate each seat independently, then split the pot.
      const participants = await store.listParticipants(dare.id);
      let unavailable = false;
      for (const p of participants) {
        if (p.aiVerdict !== "WAITING") continue;
        if (!p.proofImageUrl && !p.proofLink) {
          await store.updateParticipant(p.id, {
            aiVerdict: "INVALID",
            verdictReason: "no proof submitted before deadline",
          });
          continue;
        }
        const verdict = await adjudicateDare({
          ...dare,
          proofImageUrl: p.proofImageUrl,
          proofLink: p.proofLink,
          verifierLink: dare.verifierLink,
        });
        if (verdict.status === "UNAVAILABLE") {
          stats.unresolved_unavailable += 1;
          unavailable = true;
          break;
        }
        await store.updateParticipant(p.id, {
          aiVerdict: verdict.status,
          verdictReason: verdict.reason,
          confidence: verdict.confidence ?? null,
        });
        if (verdict.status === "VALID") stats.adjudicated_valid += 1;
        else if (verdict.status === "AMBIGUOUS") stats.adjudicated_ambiguous += 1;
        else stats.adjudicated_invalid += 1;
      }
      if (unavailable) {
        await store.updateDare(dare.id, {
          verifierResult: { status: "UNAVAILABLE", reason: "verifier credentials missing" },
        });
        continue;
      }

      const settled = await store.listParticipants(dare.id);
      const result = await settleRoom(dare, settled);
      let settledCount = 0;
      let pendingCount = 0;
      for (const payout of result.payouts) {
        const status = payout.status;
        if (status === "SETTLED") settledCount += 1;
        else if (status === "PENDING") pendingCount += 1;
        if (!settled.some((seat) => seat.id === payout.participantId)) {
          await store.recordTx({
            dareId: dare.id,
            kind: "SLASH_POOL",
            chain,
            asset: dare.asset,
            amountRaw: payout.amountRaw,
            toAddress: payout.address,
            txHash: payout.txHash,
            status: status === "SETTLED" ? "CONFIRMED" : "PENDING",
          });
          continue;
        }
        const p = settled.find((s) => s.id === payout.participantId);
        await store.updateParticipant(payout.participantId, {
          aiVerdict: p?.aiVerdict ?? "INVALID",
          payoutAmountRaw: payout.amountRaw,
          payoutTxHash: payout.txHash ?? null,
          payoutStatus: status === "SETTLED" ? "SETTLED" : status === "FAILED" ? "FAILED" : "PENDING",
        });
        await store.recordTx({
          dareId: dare.id,
          kind: "PAYOUT",
          chain,
          asset: dare.asset,
          amountRaw: payout.amountRaw,
          toAddress: payout.address,
          txHash: payout.txHash,
          status: status === "SETTLED" ? "CONFIRMED" : "PENDING",
        });
      }
      await store.updateDare(dare.id, { status: "SETTLED" });
      stats.pool_fee_raw = (BigInt(stats.pool_fee_raw) + result.feeRaw).toString();
      stats.payouts_settled += settledCount;
      stats.payouts_pending += pendingCount;
      stats.rooms_settled += 1;
      continue;
    }

    if (dare.status === "ACTIVE") {
      // Solo, deadline passed with no proof submitted: route to charity or slash pool.
      const charity = getNimCharityAddress();
      if (charity) {
        const { buildNimSweepTx } = await import("@/lib/escrow/nim");
        const res = await buildNimSweepTx(charity, dare.amountRaw, BigInt(process.env.NIM_FEE_LUNA ?? "100"));
        await store.updateDare(dare.id, {
          status: "LOST",
          payoutStatus: res.ok ? "SETTLED" : "FAILED",
          payoutTxHash: res.ok ? res.txHash : null,
          verifierResult: { status: "INVALID", reason: "no proof submitted before deadline" },
        });
        await store.recordTx({
          dareId: dare.id,
          kind: "SLASH_POOL",
          chain,
          asset: dare.asset,
          amountRaw: dare.amountRaw,
          toAddress: charity,
          txHash: res.ok ? res.txHash : null,
          status: res.ok ? "CONFIRMED" : "PENDING",
        });
      } else {
        await store.updateDare(dare.id, {
          status: "LOST",
          payoutStatus: null,
          verifierResult: { status: "INVALID", reason: "no proof submitted before deadline" },
        });
        await store.recordTx({
          dareId: dare.id,
          kind: "SLASH_POOL",
          chain,
          asset: dare.asset,
          amountRaw: dare.amountRaw,
          status: "CONFIRMED",
        });
      }
      stats.lost_no_proof += 1;
      continue;
    }

    // SUBMITTED: proofs are judged when they are submitted, so a stored ruling
    // is authoritative here. Only an unjudged or offline one is re-run.
    const stored = dare.verifierResult;
    const verdict: AdjudicationResult =
      stored &&
      (stored.status === "VALID" || stored.status === "INVALID" || stored.status === "AMBIGUOUS")
        ? {
            status: stored.status,
            reason: stored.reason ?? "",
            source: stored.source,
            confidence: stored.confidence,
            observations: stored.observations,
          }
        : await adjudicateDare(dare);
    if (verdict.status === "UNAVAILABLE") {
      stats.unresolved_unavailable += 1;
      await store.updateDare(dare.id, {
        verifierResult: {
          status: "UNAVAILABLE",
          reason: verdict.reason,
          observations: dare.verifierResult?.observations,
        },
      });
      continue;
    }

    if (verdict.status === "AMBIGUOUS") {
      // The judge could not tell. Returning the stake is the only honest
      // outcome: an inconclusive read must never take someone's money.
      stats.adjudicated_ambiguous += 1;
      await store.updateDare(dare.id, {
        status: "VOIDED",
        payoutStatus: "PENDING",
        verifierResult: verdictToRecord(verdict),
      });
      const refund = await payoutDare({ ...dare, status: "VOIDED" });
      await store.updateDare(dare.id, {
        payoutStatus: refund.status,
        payoutTxHash: refund.txHash ?? null,
      });
      await store.recordTx({
        dareId: dare.id,
        kind: "PAYOUT",
        chain,
        asset: dare.asset,
        amountRaw: dare.amountRaw,
        toAddress: dare.ownerAddress,
        txHash: refund.txHash ?? null,
        status: refund.status === "SETTLED" ? "CONFIRMED" : "PENDING",
      });
      if (refund.status === "SETTLED") stats.refunded += 1;
      else stats.payouts_pending += 1;
      continue;
    }

    if (verdict.status === "VALID") {
      await store.updateDare(dare.id, { verifierResult: verdictToRecord(verdict) });
      const payout = await settleSoloWin(dare.id);
      if (payout.status === "SETTLED") stats.payouts_settled += 1;
      else if (payout.status === "PENDING") stats.payouts_pending += 1;
      else stats.payouts_failed += 1;
      stats.adjudicated_valid += 1;
    } else {
      await store.updateDare(dare.id, {
        status: "LOST",
        payoutStatus: null,
        verifierResult: verdictToRecord(verdict),
      });
      await store.recordTx({ dareId: dare.id, kind: "SLASH_POOL", chain, asset: dare.asset, amountRaw: dare.amountRaw, status: "CONFIRMED" });
      stats.adjudicated_invalid += 1;
    }
  }

  return NextResponse.json({ ok: true, stats, store: store.label });
}
