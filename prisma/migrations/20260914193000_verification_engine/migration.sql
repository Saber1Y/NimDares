-- AlterEnum
-- Safe inside a transaction on PostgreSQL 12+: the new value is not used by this migration.
ALTER TYPE "VerifierState" ADD VALUE 'AMBIGUOUS';

-- AlterTable
ALTER TABLE "Dare" ADD COLUMN     "evidenceSpec" JSONB,
ADD COLUMN     "proofAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "proofHash" TEXT;

-- AlterTable
ALTER TABLE "Participant" ADD COLUMN     "confidence" INTEGER,
ADD COLUMN     "proofAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "proofHash" TEXT;

-- CreateIndex
CREATE INDEX "Dare_proofHash_idx" ON "Dare"("proofHash");

-- CreateIndex
CREATE INDEX "Participant_proofHash_idx" ON "Participant"("proofHash");
