CREATE TYPE "PollState" AS ENUM ('OPEN', 'CLOSED', 'RESOLVED');

CREATE TYPE "PollSide" AS ENUM ('SIDE_A', 'SIDE_B');

CREATE TYPE "VoteIntentStatus" AS ENUM (
  'DRAFT',
  'AWAITING_ESCROW_PAYMENT',
  'STAKE_CONFIRMED',
  'EXPIRED',
  'FAILED',
  'CANCELLED',
  'BLOCKED_CLOSED'
);

CREATE TYPE "PollPayoutStatus" AS ENUM ('UNCLAIMED', 'SUBMITTED', 'PAID', 'FAILED');

CREATE TABLE "polls" (
  "id" TEXT NOT NULL,
  "creator_telegram_id" BIGINT NOT NULL,
  "network_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "side_a_label" TEXT NOT NULL,
  "side_b_label" TEXT NOT NULL,
  "state" "PollState" NOT NULL,
  "closed_at" TIMESTAMP(3),
  "resolved_at" TIMESTAMP(3),
  "winning_outcome" "PollSide",
  "payout_id_hex" TEXT,
  "merkle_root_hex" TEXT,
  "payout_committed_at" TIMESTAMP(3),
  "payout_commit_tx_hash" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "polls_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vote_intents" (
  "id" TEXT NOT NULL,
  "poll_id" TEXT NOT NULL,
  "telegram_id" BIGINT NOT NULL,
  "outcome" "PollSide" NOT NULL,
  "amount_base_units" TEXT NOT NULL,
  "status" "VoteIntentStatus" NOT NULL,
  "pending_transfer_id" TEXT UNIQUE,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "stake_confirmed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "vote_intents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "poll_winner_payouts" (
  "id" TEXT NOT NULL,
  "poll_id" TEXT NOT NULL,
  "telegram_id" BIGINT NOT NULL,
  "amount_owed_base_units" TEXT NOT NULL,
  "merkle_proof_tokens" JSONB NOT NULL,
  "status" "PollPayoutStatus" NOT NULL,
  "outbound_tx_hash" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "poll_winner_payouts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "polls" ADD CONSTRAINT "polls_network_id_fkey"
  FOREIGN KEY ("network_id") REFERENCES "networks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "polls_creator_telegram_id_idx" ON "polls"("creator_telegram_id");

CREATE INDEX "vote_intents_poll_id_status_idx" ON "vote_intents"("poll_id", "status");

CREATE INDEX "vote_intents_telegram_id_idx" ON "vote_intents"("telegram_id");

ALTER TABLE "vote_intents" ADD CONSTRAINT "vote_intents_poll_id_fkey"
  FOREIGN KEY ("poll_id") REFERENCES "polls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vote_intents" ADD CONSTRAINT "vote_intents_pending_transfer_id_fkey"
  FOREIGN KEY ("pending_transfer_id") REFERENCES "pending_transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "poll_winner_payouts" ADD CONSTRAINT "poll_winner_payouts_poll_id_fkey"
  FOREIGN KEY ("poll_id") REFERENCES "polls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "poll_winner_payouts_poll_id_telegram_id_key"
  ON "poll_winner_payouts"("poll_id", "telegram_id");
