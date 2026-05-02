-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM (
    'AWAITING_OTP',
    'BROADCASTING',
    'SUBMITTED',
    'CONFIRMED',
    'TIMEOUT',
    'FAILED',
    'EXPIRED',
    'CANCELLED'
);

-- CreateTable
CREATE TABLE "users" (
    "telegram_id" BIGINT NOT NULL,
    "address" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("telegram_id")
);

-- CreateTable
CREATE TABLE "pending_transfers" (
    "id" TEXT NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "recipient" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "otp_hash" TEXT NOT NULL,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "status" "TransferStatus" NOT NULL,
    "tx_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),

    CONSTRAINT "pending_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_address_key" ON "users"("address");

-- CreateIndex
CREATE INDEX "pending_transfers_telegram_id_status_idx" ON "pending_transfers"("telegram_id", "status");

-- AddForeignKey
ALTER TABLE "pending_transfers"
ADD CONSTRAINT "pending_transfers_telegram_id_fkey"
FOREIGN KEY ("telegram_id") REFERENCES "users"("telegram_id")
ON DELETE RESTRICT ON UPDATE CASCADE;
