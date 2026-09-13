-- CreateEnum
CREATE TYPE "Asset" AS ENUM ('NIM', 'USDT');

-- CreateEnum
CREATE TYPE "DareStatus" AS ENUM ('PENDING_FUNDING', 'LOBBY', 'ACTIVE', 'SUBMITTED', 'ADJUDICATED', 'SETTLED', 'WON', 'LOST', 'SWEEPING', 'VOIDED');

-- CreateEnum
CREATE TYPE "VerifierKind" AS ENUM ('VISION', 'GITHUB', 'STRAVA');

-- CreateEnum
CREATE TYPE "VerifierState" AS ENUM ('VALID', 'INVALID', 'UNAVAILABLE', 'WAITING');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'SETTLED', 'FAILED');

-- CreateEnum
CREATE TYPE "TxKind" AS ENUM ('ESCROW_DEPOSIT', 'SWEEP', 'SLASH_POOL', 'PAYOUT');

-- CreateEnum
CREATE TYPE "TxChain" AS ENUM ('NIM', 'EVM');

-- CreateEnum
CREATE TYPE "TxStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latestLoginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dare" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "criteria" TEXT NOT NULL,
    "asset" "Asset" NOT NULL,
    "amountRaw" BIGINT NOT NULL,
    "maxCapacity" INTEGER NOT NULL DEFAULT 1,
    "isPrivate" BOOLEAN NOT NULL DEFAULT true,
    "roomCode" TEXT,
    "deadline" TIMESTAMP(3) NOT NULL,
    "status" "DareStatus" NOT NULL DEFAULT 'PENDING_FUNDING',
    "verifierKind" "VerifierKind" NOT NULL,
    "verifierLink" TEXT,
    "verifierResult" JSONB,
    "proofImageUrl" TEXT,
    "escrowTxHash" TEXT,
    "payoutTxHash" TEXT,
    "payoutStatus" "PayoutStatus",
    "fundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participant" (
    "id" TEXT NOT NULL,
    "dareId" TEXT NOT NULL,
    "userAddress" TEXT NOT NULL,
    "stakeRaw" BIGINT NOT NULL,
    "fundingTxHash" TEXT,
    "fundedAt" TIMESTAMP(3),
    "proofImageUrl" TEXT,
    "proofLink" TEXT,
    "aiVerdict" "VerifierState" NOT NULL DEFAULT 'WAITING',
    "verdictReason" TEXT,
    "payoutAmountRaw" BIGINT NOT NULL DEFAULT 0,
    "payoutTxHash" TEXT,
    "payoutStatus" "PayoutStatus",
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TxRecord" (
    "id" TEXT NOT NULL,
    "dareId" TEXT,
    "userId" TEXT,
    "kind" "TxKind" NOT NULL,
    "chain" "TxChain" NOT NULL,
    "asset" "Asset" NOT NULL,
    "amountRaw" BIGINT NOT NULL,
    "fromAddress" TEXT,
    "toAddress" TEXT,
    "txHash" TEXT,
    "status" "TxStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TxRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscrowBalance" (
    "id" TEXT NOT NULL,
    "asset" "Asset" NOT NULL,
    "chain" "TxChain" NOT NULL,
    "address" TEXT NOT NULL,
    "balanceRaw" BIGINT NOT NULL DEFAULT 0,
    "reservedRaw" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EscrowBalance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_address_key" ON "User"("address");

-- CreateIndex
CREATE INDEX "Dare_ownerId_idx" ON "Dare"("ownerId");

-- CreateIndex
CREATE INDEX "Dare_status_idx" ON "Dare"("status");

-- CreateIndex
CREATE INDEX "Dare_isPrivate_status_idx" ON "Dare"("isPrivate", "status");

-- CreateIndex
CREATE INDEX "Dare_createdAt_idx" ON "Dare"("createdAt");

-- CreateIndex
CREATE INDEX "Participant_dareId_idx" ON "Participant"("dareId");

-- CreateIndex
CREATE INDEX "Participant_userAddress_idx" ON "Participant"("userAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_dareId_userAddress_key" ON "Participant"("dareId", "userAddress");

-- CreateIndex
CREATE INDEX "TxRecord_dareId_idx" ON "TxRecord"("dareId");

-- CreateIndex
CREATE INDEX "TxRecord_userId_idx" ON "TxRecord"("userId");

-- CreateIndex
CREATE INDEX "TxRecord_status_idx" ON "TxRecord"("status");

-- CreateIndex
CREATE UNIQUE INDEX "EscrowBalance_asset_chain_address_key" ON "EscrowBalance"("asset", "chain", "address");

-- AddForeignKey
ALTER TABLE "Dare" ADD CONSTRAINT "Dare_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_dareId_fkey" FOREIGN KEY ("dareId") REFERENCES "Dare"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TxRecord" ADD CONSTRAINT "TxRecord_dareId_fkey" FOREIGN KEY ("dareId") REFERENCES "Dare"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TxRecord" ADD CONSTRAINT "TxRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
