"server-only";

import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import type {
  Asset,
  DareStatus,
  DareVerifierResult,
  PayoutStatus,
  VerifierKind,
} from "@/lib/types";

export type { Asset, DareStatus, PayoutStatus, VerifierKind };

export interface NewDareInput {
  ownerAddress: string;
  title: string;
  description: string;
  criteria: string;
  asset: Asset;
  amountRaw: bigint;
  deadline: Date;
  verifierKind: VerifierKind;
  verifierLink?: string | null;
  evidenceSpec?: unknown;
  timezone?: string | null;
  maxCapacity?: number;
  isPrivate?: boolean;
  roomCode?: string | null;
}

export interface DareRecord {
  id: string;
  ownerAddress: string;
  title: string;
  description: string;
  criteria: string;
  asset: Asset;
  amountRaw: bigint;
  maxCapacity: number;
  isPrivate: boolean;
  roomCode: string | null;
  deadline: Date;
  status: DareStatus;
  verifierKind: VerifierKind;
  verifierLink: string | null;
  /** Proof artifact supplied for non-image verifiers (URL). Not a stored column
   *  on solo dares - for solo dares it travels in verifierResult.observations. */
  proofLink?: string | null;
  verifierResult: DareVerifierResult | null;
  /** IANA zone the dare was created in; null for dares made before it was captured. */
  timezone: string | null;
  evidenceSpec: unknown;
  proofImageUrl: string | null;
  proofHash: string | null;
  proofAttempts: number;
  escrowTxHash: string | null;
  payoutTxHash: string | null;
  payoutStatus: PayoutStatus | null;
  fundedAt: Date | null;
  createdAt: Date;
}

export interface ParticipantRecord {
  id: string;
  dareId: string;
  userAddress: string;
  stakeRaw: bigint;
  fundingTxHash: string | null;
  fundedAt: Date | null;
  proofImageUrl: string | null;
  proofLink: string | null;
  aiVerdict: VerifierState;
  verdictReason: string | null;
  confidence: number | null;
  proofHash: string | null;
  proofAttempts: number;
  payoutAmountRaw: bigint;
  payoutTxHash: string | null;
  payoutStatus: PayoutStatus;
  joinedAt: Date;
}

export interface NewParticipantInput {
  dareId: string;
  userAddress: string;
  stakeRaw: bigint;
}

export interface NewTxInput {
  dareId?: string | null;
  userId?: string | null;
  kind: "ESCROW_DEPOSIT" | "SWEEP" | "SLASH_POOL" | "PAYOUT";
  chain: "NIM" | "EVM";
  asset: Asset;
  amountRaw: bigint;
  fromAddress?: string | null;
  toAddress?: string | null;
  txHash?: string | null;
  status?: "PENDING" | "CONFIRMED" | "FAILED" | "UNKNOWN";
}

export type VerifierState = "VALID" | "INVALID" | "AMBIGUOUS" | "UNAVAILABLE" | "WAITING";

export interface FundedClaim {
  kind: "dare" | "participant";
  id: string;
}

export interface EscrowBalanceRecord {
  asset: Asset;
  chain: "NIM" | "EVM";
  address: string;
  balanceRaw: bigint;
  reservedRaw: bigint;
  updatedAt: Date;
}

export interface LedgerSummary {
  active: number;
  escrowedNim: bigint;
  escrowedUsdt: bigint;
  won: number;
  lost: number;
}

export interface TxRecordRow {
  id: string;
  dareId: string | null;
  kind: string;
  chain: string;
  asset: Asset;
  amountRaw: bigint;
  fromAddress: string | null;
  toAddress: string | null;
  txHash: string | null;
  status: string;
  createdAt: Date;
}

export interface LedgerStore {
  label: string;
  getOrCreateUser(address: string): Promise<{ id: string; address: string }>;
  touchUser(address: string): Promise<void>;
  createDare(input: NewDareInput): Promise<DareRecord>;
  getDare(id: string): Promise<DareRecord | null>;
  /** Dares this address owns or holds a seat in. Empty without an address. */
  listDares(ownerAddress?: string): Promise<DareRecord[]>;
  /** Every dare, for settlement passes. Never reachable from a request parameter. */
  listAllDares(limit?: number): Promise<DareRecord[]>;
  listOpenRooms(): Promise<DareRecord[]>;
  updateDare(
    id: string,
    patch: Partial<Omit<DareRecord, "id">>
  ): Promise<DareRecord | null>;
  deleteDare(id: string): Promise<boolean>;
  deleteParticipants(dareId: string): Promise<void>;
  createParticipant(input: NewParticipantInput): Promise<ParticipantRecord>;
  getParticipant(id: string): Promise<ParticipantRecord | null>;
  listParticipants(dareId: string): Promise<ParticipantRecord[]>;
  updateParticipant(
    id: string,
    patch: Partial<Omit<ParticipantRecord, "id">>
  ): Promise<ParticipantRecord | null>;
  /** Finds the stake a settled deposit already paid for, so none is credited twice. */
  findFundedByTxHash(hash: string): Promise<FundedClaim | null>;
  /** True when this exact image has already been submitted as proof elsewhere. */
  proofHashSeen(hash: string, exclude: { dareId?: string; participantId?: string }): Promise<boolean>;
  recordTx(input: NewTxInput): Promise<{ id: string }>;
  getEscrowBalance(
    asset: Asset,
    chain: "NIM" | "EVM",
    address: string
  ): Promise<EscrowBalanceRecord>;
  bumpEscrowBalance(
    asset: Asset,
    chain: "NIM" | "EVM",
    address: string,
    deltaRaw: bigint
  ): Promise<EscrowBalanceRecord>;
  summary(): Promise<LedgerSummary>;
  listTransactions(limit?: number): Promise<TxRecordRow[]>;
  listEscrowBalances(): Promise<EscrowBalanceRecord[]>;
}

const prismaState = (() => {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  // Supabase pgbouncer caps the pooled connection count (pool_size 15) and
  // rejects new clients once it is reached. Serverless instances would each
  // open cpus*2+1 connections by default, exhausting the pool, so pin each
  // instance to exactly one connection.
  const limited = url.includes("?")
    ? `${url}&connection_limit=1`
    : `${url}?connection_limit=1`;
  const adapter = new PrismaPg({ connectionString: limited });
  return new PrismaClient({ adapter });
})();

function prisma(): PrismaClient {
  if (!prismaState) throw new Error("DATABASE_URL not configured");
  return prismaState;
}

function fromPrismaDare(d: {
  id: string;
  owner: { address: string };
  title: string;
  description: string;
  criteria: string;
  asset: Asset;
  amountRaw: bigint;
  maxCapacity: number;
  isPrivate: boolean;
  roomCode: string | null;
  deadline: Date;
  status: DareStatus;
  verifierKind: VerifierKind;
  verifierLink: string | null;
  verifierResult: unknown;
  timezone: string | null;
  evidenceSpec: unknown;
  proofImageUrl: string | null;
  proofHash: string | null;
  proofAttempts: number;
  escrowTxHash: string | null;
  payoutTxHash: string | null;
  payoutStatus: PayoutStatus | null;
  fundedAt: Date | null;
  createdAt: Date;
}): DareRecord {
  return {
    id: d.id,
    ownerAddress: d.owner.address,
    title: d.title,
    description: d.description,
    criteria: d.criteria,
    asset: d.asset,
    amountRaw: d.amountRaw,
    maxCapacity: d.maxCapacity,
    isPrivate: d.isPrivate,
    roomCode: d.roomCode,
    deadline: d.deadline,
    status: d.status,
    verifierKind: d.verifierKind,
    verifierLink: d.verifierLink,
    verifierResult: (d.verifierResult as DareVerifierResult | null) ?? null,
    timezone: d.timezone,
    evidenceSpec: d.evidenceSpec ?? null,
    proofImageUrl: d.proofImageUrl,
    proofHash: d.proofHash,
    proofAttempts: d.proofAttempts,
    escrowTxHash: d.escrowTxHash,
    payoutTxHash: d.payoutTxHash,
    payoutStatus: d.payoutStatus,
    fundedAt: d.fundedAt,
    createdAt: d.createdAt,
  };
}

function fromPrismaParticipant(p: {
  id: string;
  dareId: string;
  userAddress: string;
  stakeRaw: bigint;
  fundingTxHash: string | null;
  fundedAt: Date | null;
  proofImageUrl: string | null;
  proofLink: string | null;
  aiVerdict: VerifierState;
  verdictReason: string | null;
  confidence: number | null;
  proofHash: string | null;
  proofAttempts: number;
  payoutAmountRaw: bigint;
  payoutTxHash: string | null;
  payoutStatus: PayoutStatus;
  joinedAt: Date;
}): ParticipantRecord {
  return {
    id: p.id,
    dareId: p.dareId,
    userAddress: p.userAddress,
    stakeRaw: p.stakeRaw,
    fundingTxHash: p.fundingTxHash,
    fundedAt: p.fundedAt,
    proofImageUrl: p.proofImageUrl,
    proofLink: p.proofLink,
    aiVerdict: p.aiVerdict,
    verdictReason: p.verdictReason,
    confidence: p.confidence,
    proofHash: p.proofHash,
    proofAttempts: p.proofAttempts,
    payoutAmountRaw: p.payoutAmountRaw,
    payoutTxHash: p.payoutTxHash,
    payoutStatus: p.payoutStatus,
    joinedAt: p.joinedAt,
  };
}

class PrismaLedgerStore implements LedgerStore {
  label = "prisma";
  private db() {
    return prisma();
  }

  async getOrCreateUser(address: string) {
    return this.db().user.upsert({
      where: { address },
      create: { address, latestLoginAt: new Date() },
      update: { latestLoginAt: new Date() },
    });
  }

  async touchUser(address: string) {
    await this.db().user.update({
      where: { address },
      data: { latestLoginAt: new Date() },
    });
  }

  async createDare(input: NewDareInput) {
    const owner = await this.getOrCreateUser(input.ownerAddress);
    const d = await this.db().dare.create({
      data: {
        ownerId: owner.id,
        title: input.title,
        description: input.description,
        criteria: input.criteria,
        asset: input.asset,
        amountRaw: input.amountRaw,
        deadline: input.deadline,
        verifierKind: input.verifierKind,
        verifierLink: input.verifierLink ?? null,
        maxCapacity: input.maxCapacity ?? 1,
        isPrivate: input.isPrivate ?? true,
        roomCode: input.roomCode ?? null,
        status: (input.maxCapacity ?? 1) > 1 ? "LOBBY" : "PENDING_FUNDING",
        evidenceSpec: (input.evidenceSpec ?? null) as object | undefined,
        timezone: input.timezone ?? null,
      },
      include: { owner: true },
    });
    return fromPrismaDare(d);
  }

  async getDare(id: string) {
    const d = await this.db().dare.findUnique({ where: { id }, include: { owner: true } });
    return d ? fromPrismaDare(d) : null;
  }

  async listDares(ownerAddress?: string) {
    if (!ownerAddress) return [];
    const owner = await this.db().user.findUnique({ where: { address: ownerAddress } });
    // A seat in someone else's room is still your dare: your stake is in it,
    // you submit proof for it, and you are paid out of it.
    const dares = await this.db().dare.findMany({
      where: {
        OR: [
          ...(owner ? [{ ownerId: owner.id }] : []),
          { participants: { some: { userAddress: ownerAddress } } },
        ],
      },
      include: { owner: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return dares.map(fromPrismaDare);
  }

  async listAllDares(limit = 500) {
    const dares = await this.db().dare.findMany({
      include: { owner: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return dares.map(fromPrismaDare);
  }

  async listOpenRooms() {
    const rooms = await this.db().dare.findMany({
      where: { isPrivate: false, status: { in: ["LOBBY", "ACTIVE"] } },
      include: { owner: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return rooms.map(fromPrismaDare);
  }

  async updateDare(id: string, patch: Partial<Omit<DareRecord, "id">>) {
    const data: Record<string, unknown> = {};
    if (patch.title !== undefined) data.title = patch.title;
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.criteria !== undefined) data.criteria = patch.criteria;
    if (patch.asset !== undefined) data.asset = patch.asset;
    if (patch.amountRaw !== undefined) data.amountRaw = patch.amountRaw;
    if (patch.deadline !== undefined) data.deadline = patch.deadline;
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.verifierKind !== undefined) data.verifierKind = patch.verifierKind;
    if (patch.verifierLink !== undefined) data.verifierLink = patch.verifierLink;
    if (patch.verifierResult !== undefined)
      data.verifierResult = patch.verifierResult as { status: string };
    if (patch.proofImageUrl !== undefined) data.proofImageUrl = patch.proofImageUrl;
    if (patch.proofHash !== undefined) data.proofHash = patch.proofHash;
    if (patch.proofAttempts !== undefined) data.proofAttempts = patch.proofAttempts;
    if (patch.evidenceSpec !== undefined) data.evidenceSpec = patch.evidenceSpec;
    if (patch.timezone !== undefined) data.timezone = patch.timezone;
    if (patch.escrowTxHash !== undefined) data.escrowTxHash = patch.escrowTxHash;
    if (patch.payoutTxHash !== undefined) data.payoutTxHash = patch.payoutTxHash;
    if (patch.payoutStatus !== undefined) data.payoutStatus = patch.payoutStatus;
    if (patch.fundedAt !== undefined) data.fundedAt = patch.fundedAt;
    if (patch.maxCapacity !== undefined) data.maxCapacity = patch.maxCapacity;
    if (patch.isPrivate !== undefined) data.isPrivate = patch.isPrivate;
    if (patch.roomCode !== undefined) data.roomCode = patch.roomCode;
    const d = await this.db().dare.update({
      where: { id },
      data,
      include: { owner: true },
    });
    return fromPrismaDare(d);
  }

  async deleteDare(id: string) {
    await this.db().$transaction(async (tx) => {
      await tx.participant.deleteMany({ where: { dareId: id } });
      await tx.txRecord.deleteMany({ where: { dareId: id } });
      await tx.dare.delete({ where: { id } });
    });
    return true;
  }

  async deleteParticipants(dareId: string) {
    await this.db().participant.deleteMany({ where: { dareId } });
  }

  async createParticipant(input: NewParticipantInput) {
    await this.getOrCreateUser(input.userAddress);
    const p = await this.db().participant.create({
      data: {
        dareId: input.dareId,
        userAddress: input.userAddress,
        stakeRaw: input.stakeRaw,
      },
    });
    return fromPrismaParticipant(p);
  }

  async getParticipant(id: string) {
    const p = await this.db().participant.findUnique({ where: { id } });
    return p ? fromPrismaParticipant(p) : null;
  }

  async listParticipants(dareId: string) {
    const rows = await this.db().participant.findMany({
      where: { dareId },
      orderBy: { joinedAt: "asc" },
    });
    return rows.map(fromPrismaParticipant);
  }

  async updateParticipant(id: string, patch: Partial<Omit<ParticipantRecord, "id">>) {
    const data: Record<string, unknown> = {};
    if (patch.dareId !== undefined) data.dareId = patch.dareId;
    if (patch.userAddress !== undefined) data.userAddress = patch.userAddress;
    if (patch.stakeRaw !== undefined) data.stakeRaw = patch.stakeRaw;
    if (patch.fundingTxHash !== undefined) data.fundingTxHash = patch.fundingTxHash;
    if (patch.fundedAt !== undefined) data.fundedAt = patch.fundedAt;
    if (patch.proofImageUrl !== undefined) data.proofImageUrl = patch.proofImageUrl;
    if (patch.proofLink !== undefined) data.proofLink = patch.proofLink;
    if (patch.aiVerdict !== undefined) data.aiVerdict = patch.aiVerdict;
    if (patch.verdictReason !== undefined) data.verdictReason = patch.verdictReason;
    if (patch.confidence !== undefined) data.confidence = patch.confidence;
    if (patch.proofHash !== undefined) data.proofHash = patch.proofHash;
    if (patch.proofAttempts !== undefined) data.proofAttempts = patch.proofAttempts;
    if (patch.payoutAmountRaw !== undefined) data.payoutAmountRaw = patch.payoutAmountRaw;
    if (patch.payoutTxHash !== undefined) data.payoutTxHash = patch.payoutTxHash;
    if (patch.payoutStatus !== undefined) data.payoutStatus = patch.payoutStatus;
    const p = await this.db().participant.update({ where: { id }, data });
    return fromPrismaParticipant(p);
  }

  async proofHashSeen(hash: string, exclude: { dareId?: string; participantId?: string }) {
    const dare = await this.db().dare.findFirst({
      where: { proofHash: hash, id: exclude.dareId ? { not: exclude.dareId } : undefined },
      select: { id: true },
    });
    if (dare) return true;
    const seat = await this.db().participant.findFirst({
      where: {
        proofHash: hash,
        id: exclude.participantId ? { not: exclude.participantId } : undefined,
      },
      select: { id: true },
    });
    return seat !== null;
  }

  async findFundedByTxHash(hash: string): Promise<FundedClaim | null> {
    const dare = await this.db().dare.findFirst({
      where: { escrowTxHash: hash, fundedAt: { not: null } },
      select: { id: true },
    });
    if (dare) return { kind: "dare", id: dare.id };
    const seat = await this.db().participant.findFirst({
      where: { fundingTxHash: hash, fundedAt: { not: null } },
      select: { id: true },
    });
    return seat ? { kind: "participant", id: seat.id } : null;
  }

  async recordTx(input: NewTxInput) {
    const rec = await this.db().txRecord.create({
      data: {
        dareId: input.dareId ?? null,
        userId: input.userId ?? null,
        kind: input.kind,
        chain: input.chain,
        asset: input.asset,
        amountRaw: input.amountRaw,
        fromAddress: input.fromAddress ?? null,
        toAddress: input.toAddress ?? null,
        txHash: input.txHash ?? null,
        status: input.status ?? "PENDING",
      },
    });
    return { id: rec.id };
  }

  async getEscrowBalance(asset: Asset, chain: "NIM" | "EVM", address: string) {
    const row = await this.db().escrowBalance.upsert({
      where: { asset_chain_address: { asset, chain, address } },
      create: { asset, chain, address },
      update: {},
    });
    return {
      asset,
      chain,
      address,
      balanceRaw: row.balanceRaw,
      reservedRaw: row.reservedRaw,
      updatedAt: row.updatedAt,
    };
  }

  async bumpEscrowBalance(asset: Asset, chain: "NIM" | "EVM", address: string, deltaRaw: bigint) {
    const row = await this.db().escrowBalance.update({
      where: { asset_chain_address: { asset, chain, address } },
      data: { balanceRaw: { increment: deltaRaw } },
    });
    return {
      asset,
      chain,
      address,
      balanceRaw: row.balanceRaw,
      reservedRaw: row.reservedRaw,
      updatedAt: row.updatedAt,
    };
  }

  async summary(): Promise<LedgerSummary> {
    // Run sequentially: each aggregate takes a pooled connection, and running
    // them in parallel makes a single request burst the shared pgbouncer cap.
    const activeAgg = await this.db().dare.count({ where: { status: { in: ["PENDING_FUNDING", "ACTIVE", "SUBMITTED"] } } });
    const nimAgg = await this.db().escrowBalance.aggregate({ where: { asset: "NIM" }, _sum: { balanceRaw: true } });
    const usdtAgg = await this.db().escrowBalance.aggregate({ where: { asset: "USDT" }, _sum: { balanceRaw: true } });
    const wonAgg = await this.db().dare.count({ where: { status: "WON" } });
    const lostAgg = await this.db().dare.count({ where: { status: "LOST" } });
    return {
      active: activeAgg,
      escrowedNim: nimAgg._sum.balanceRaw ?? 0n,
      escrowedUsdt: usdtAgg._sum.balanceRaw ?? 0n,
      won: wonAgg,
      lost: lostAgg,
    };
  }

  async listTransactions(limit = 50): Promise<TxRecordRow[]> {
    const rows = await this.db().txRecord.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      dareId: r.dareId,
      kind: r.kind,
      chain: r.chain,
      asset: r.asset as Asset,
      amountRaw: r.amountRaw,
      fromAddress: r.fromAddress,
      toAddress: r.toAddress,
      txHash: r.txHash,
      status: r.status,
      createdAt: r.createdAt,
    }));
  }

  async listEscrowBalances(): Promise<EscrowBalanceRecord[]> {
    const rows = await this.db().escrowBalance.findMany();
    return rows.map((r) => ({
      asset: r.asset as Asset,
      chain: r.chain as "NIM" | "EVM",
      address: r.address,
      balanceRaw: r.balanceRaw,
      reservedRaw: r.reservedRaw,
      updatedAt: r.updatedAt,
    }));
  }
}

class MemoryLedgerStore implements LedgerStore {
  label = "memory";
  private users = new Map<string, { id: string; address: string }>();
  private dares = new Map<string, DareRecord>();
  private participants = new Map<string, ParticipantRecord>();
  private txs: { id: string; dareId: string | null; kind: NewTxInput["kind"]; asset: Asset }[] = [];
  private escrow = new Map<string, EscrowBalanceRecord>();

  private escrowKey(asset: Asset, chain: "NIM" | "EVM", address: string) {
    return `${chain}:${asset}:${address}`;
  }

  async getOrCreateUser(address: string) {
    let u = this.users.get(address);
    if (!u) {
      u = { id: randomUUID(), address };
      this.users.set(address, u);
    }
    return u;
  }

  async touchUser(address: string) {
    await this.getOrCreateUser(address);
  }

  async createDare(input: NewDareInput) {
    const d: DareRecord = {
      id: randomUUID(),
      ownerAddress: input.ownerAddress,
      title: input.title,
      description: input.description,
      criteria: input.criteria,
      asset: input.asset,
      amountRaw: input.amountRaw,
      maxCapacity: input.maxCapacity ?? 1,
      isPrivate: input.isPrivate ?? true,
      roomCode: input.roomCode ?? null,
      deadline: input.deadline,
      status: (input.maxCapacity ?? 1) > 1 ? "LOBBY" : "PENDING_FUNDING",
      verifierKind: input.verifierKind,
      verifierLink: input.verifierLink ?? null,
      verifierResult: null,
      evidenceSpec: input.evidenceSpec ?? null,
      timezone: input.timezone ?? null,
      proofImageUrl: null,
      proofHash: null,
      proofAttempts: 0,
      escrowTxHash: null,
      payoutTxHash: null,
      payoutStatus: null,
      fundedAt: null,
      createdAt: new Date(),
    };
    await this.getOrCreateUser(input.ownerAddress);
    this.dares.set(d.id, d);
    return d;
  }

  async getDare(id: string) {
    return this.dares.get(id) ?? null;
  }

  async listDares(ownerAddress?: string) {
    if (!ownerAddress) return [];
    const seated = new Set(
      [...this.participants.values()]
        .filter((p) => p.userAddress === ownerAddress)
        .map((p) => p.dareId)
    );
    return [...this.dares.values()]
      .filter((d) => d.ownerAddress === ownerAddress || seated.has(d.id))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async listAllDares(limit = 500) {
    return [...this.dares.values()]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async listOpenRooms() {
    return [...this.dares.values()]
      .filter(
        (d) =>
          !d.isPrivate &&
          (d.status === "LOBBY" || d.status === "ACTIVE")
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 50);
  }

  async updateDare(id: string, patch: Partial<Omit<DareRecord, "id">>) {
    const cur = this.dares.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch, id: cur.id };
    this.dares.set(id, next);
    return next;
  }

  async deleteDare(id: string) {
    if (!this.dares.has(id)) return false;
    await this.deleteParticipants(id);
    this.txs = this.txs.filter((tx) => tx.dareId !== id);
    this.dares.delete(id);
    return true;
  }

  async deleteParticipants(dareId: string) {
    for (const [id, participant] of this.participants) {
      if (participant.dareId === dareId) this.participants.delete(id);
    }
  }

  async createParticipant(input: NewParticipantInput) {
    await this.getOrCreateUser(input.userAddress);
    const p: ParticipantRecord = {
      id: randomUUID(),
      dareId: input.dareId,
      userAddress: input.userAddress,
      stakeRaw: input.stakeRaw,
      fundingTxHash: null,
      fundedAt: null,
      proofImageUrl: null,
      proofLink: null,
      aiVerdict: "WAITING",
      verdictReason: null,
      confidence: null,
      proofHash: null,
      proofAttempts: 0,
      payoutAmountRaw: 0n,
      payoutTxHash: null,
      payoutStatus: null,
      joinedAt: new Date(),
    };
    this.participants.set(p.id, p);
    return p;
  }

  async getParticipant(id: string) {
    return this.participants.get(id) ?? null;
  }

  async listParticipants(dareId: string) {
    return [...this.participants.values()]
      .filter((p) => p.dareId === dareId)
      .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
  }

  async updateParticipant(id: string, patch: Partial<Omit<ParticipantRecord, "id">>) {
    const cur = this.participants.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch, id: cur.id };
    this.participants.set(id, next);
    return next;
  }

  async proofHashSeen(hash: string, exclude: { dareId?: string; participantId?: string }) {
    for (const d of this.dares.values()) {
      if (d.proofHash === hash && d.id !== exclude.dareId) return true;
    }
    for (const p of this.participants.values()) {
      if (p.proofHash === hash && p.id !== exclude.participantId) return true;
    }
    return false;
  }

  async findFundedByTxHash(hash: string): Promise<FundedClaim | null> {
    for (const d of this.dares.values()) {
      if (d.fundedAt && d.escrowTxHash === hash) return { kind: "dare", id: d.id };
    }
    for (const p of this.participants.values()) {
      if (p.fundedAt && p.fundingTxHash === hash) return { kind: "participant", id: p.id };
    }
    return null;
  }

  async recordTx(input: NewTxInput) {
    const id = randomUUID();
    this.txs.push({ id, dareId: input.dareId ?? null, kind: input.kind, asset: input.asset });
    return { id };
  }

  async getEscrowBalance(asset: Asset, chain: "NIM" | "EVM", address: string) {
    const key = this.escrowKey(asset, chain, address);
    let row = this.escrow.get(key);
    if (!row) {
      row = { asset, chain, address, balanceRaw: 0n, reservedRaw: 0n, updatedAt: new Date() };
      this.escrow.set(key, row);
    }
    return row;
  }

  async bumpEscrowBalance(asset: Asset, chain: "NIM" | "EVM", address: string, deltaRaw: bigint) {
    const key = this.escrowKey(asset, chain, address);
    const cur = await this.getEscrowBalance(asset, chain, address);
    const next: EscrowBalanceRecord = {
      ...cur,
      balanceRaw: cur.balanceRaw + deltaRaw,
      updatedAt: new Date(),
    };
    this.escrow.set(key, next);
    return next;
  }

  async summary(): Promise<LedgerSummary> {
    let escrowedNim = 0n;
    let escrowedUsdt = 0n;
    for (const d of this.dares.values()) {
      if ((d.status === "ACTIVE" || d.status === "SUBMITTED") && d.fundedAt) {
        if (d.asset === "NIM") escrowedNim += d.amountRaw;
        else escrowedUsdt += d.amountRaw;
      }
    }
    const statuses = [...this.dares.values()].map((d) => d.status);
    return {
      active: statuses.filter((s) => s === "ACTIVE" || s === "SUBMITTED" || s === "PENDING_FUNDING").length,
      escrowedNim,
      escrowedUsdt,
      won: statuses.filter((s) => s === "WON").length,
      lost: statuses.filter((s) => s === "LOST").length,
    };
  }

  async listTransactions(limit = 50): Promise<TxRecordRow[]> {
    return this.txs.slice(-limit).reverse().map((t) => ({
      id: t.id,
      dareId: t.dareId,
      kind: t.kind,
      chain: t.asset === "NIM" ? "NIM" : "EVM",
      asset: t.asset,
      amountRaw: 0n,
      fromAddress: null,
      toAddress: null,
      txHash: null,
      status: "UNKNOWN",
      createdAt: new Date(),
    }));
  }

  async listEscrowBalances(): Promise<EscrowBalanceRecord[]> {
    return [...this.escrow.values()];
  }
}

let store: LedgerStore | null = null;

export function getStore(): LedgerStore {
  if (!store) {
    store = process.env.DATABASE_URL
      ? new PrismaLedgerStore()
      : new MemoryLedgerStore();
  }
  return store;
}

export function storeLabel(): string {
  return getStore().label;
}
