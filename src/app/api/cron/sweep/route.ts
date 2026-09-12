import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { adjudicateDare } from "@/lib/adjudicate";
import { payoutDare } from "@/lib/payout";
import { getNimEscrowInfo, fetchNimBalance } from "@/lib/escrow/nim";
import { getEvmEscrowInfo, fetchUsdtBalance } from "@/lib/escrow/evm";

async function fundPendingDares() {
  const store = getStore();
  const nimEscrow = getNimEscrowInfo();
  const evmEscrow = getEvmEscrowInfo();
  if (!nimEscrow.configured && !evmEscrow.configured) return { funded: 0, skipped: 1 };

  const pending = (await store.listDares()).filter((d) => d.status === "PENDING_FUNDING");
  if (pending.length === 0) return { funded: 0, skipped: 0 };

  const nimPending = pending.filter((d) => d.asset === "NIM");
  const usdtPending = pending.filter((d) => d.asset === "USDT");
  let nimAvailable = 0n;
  let usdtAvailable = 0n;
  if (nimPending.length && nimEscrow.configured) {
    nimAvailable = await fetchNimBalance(nimEscrow.address);
  }
  if (usdtPending.length && evmEscrow.configured) {
    usdtAvailable = await fetchUsdtBalance(evmEscrow.address);
  }

  let funded = 0;
  for (const d of nimPending) {
    if (nimAvailable >= d.amountRaw) {
      nimAvailable -= d.amountRaw;
      await store.updateDare(d.id, { status: "ACTIVE", fundedAt: new Date() });
      funded += 1;
    }
  }
  for (const d of usdtPending) {
    if (usdtAvailable >= d.amountRaw) {
      usdtAvailable -= d.amountRaw;
      await store.updateDare(d.id, { status: "ACTIVE", fundedAt: new Date() });
      funded += 1;
    }
  }
  return { funded, skipped: 0 };
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
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
    unresolved_unavailable: 0,
    payouts_settled: 0,
    payouts_pending: 0,
    payouts_failed: 0,
  };

  const funding = await fundPendingDares();
  stats.funded = funding.funded;
  stats.funding_skipped = funding.skipped;

  const dares = await store.listDares();
  const now = Date.now();
  stats.scanned = dares.length;

  for (const dare of dares) {
    if (dare.status !== "ACTIVE" && dare.status !== "SUBMITTED") continue;
    if (new Date(dare.deadline).getTime() > now) continue;
    stats.expired += 1;

    if (dare.status === "ACTIVE") {
      // Deadline passed with no proof submitted: the stake is slashed.
      await store.updateDare(dare.id, {
        status: "LOST",
        payoutStatus: null,
        verifierResult: { status: "INVALID", reason: "no proof submitted before deadline" },
      });
      await store.recordTx({ dareId: dare.id, kind: "SLASH_POOL", chain: dare.asset === "NIM" ? "NIM" : "EVM", asset: dare.asset, amountRaw: dare.amountRaw, status: "CONFIRMED" });
      stats.lost_no_proof += 1;
      continue;
    }

    // SUBMITTED: run adjudication, then pay out or slash.
    const verdict = await adjudicateDare(dare);
    if (verdict.status === "UNAVAILABLE") {
      stats.unresolved_unavailable += 1;
      await store.updateDare(dare.id, {
        verifierResult: { status: "UNAVAILABLE", reason: verdict.reason },
      });
      continue;
    }

    if (verdict.status === "VALID") {
      await store.updateDare(dare.id, {
        status: "WON",
        payoutStatus: "PENDING",
        verifierResult: { status: "VALID", reason: verdict.reason, source: verdict.source, ruledAt: new Date().toISOString() },
      });
      const payout = await payoutDare({ ...dare, status: "WON" });
      if (payout.status === "SETTLED") {
        await store.updateDare(dare.id, { payoutStatus: "SETTLED", payoutTxHash: payout.txHash });
        stats.payouts_settled += 1;
      } else {
        await store.updateDare(dare.id, { payoutStatus: payout.status === "FAILED" ? "FAILED" : "PENDING" });
        if (payout.status === "PENDING") stats.payouts_pending += 1;
        else stats.payouts_failed += 1;
      }
    } else {
      await store.updateDare(dare.id, {
        status: "LOST",
        payoutStatus: null,
        verifierResult: { status: "INVALID", reason: verdict.reason, source: verdict.source, ruledAt: new Date().toISOString() },
      });
      await store.recordTx({ dareId: dare.id, kind: "SLASH_POOL", chain: dare.asset === "NIM" ? "NIM" : "EVM", asset: dare.asset, amountRaw: dare.amountRaw, status: "CONFIRMED" });
      stats.adjudicated_invalid += 1;
    }
  }

  return NextResponse.json({ ok: true, stats, store: store.label });
}