-- CreateTable: networks
CREATE TABLE "networks" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "display_name" TEXT NOT NULL,
    "rpc_url" TEXT NOT NULL,
    "usdc_address" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "networks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "networks_slug_key" ON "networks"("slug");

-- Seed default network row inline so backfill can reference it
INSERT INTO "networks" ("id", "slug", "chain_id", "display_name", "rpc_url", "usdc_address", "enabled")
VALUES (
    gen_random_uuid(),
    'bsc_testnet',
    97,
    'BSC Testnet',
    'https://data-seed-prebsc-1-s1.binance.org:8545',
    '0xaD88B079712CC38a8D33E072CB6434E652556441',
    true
);

-- AlterTable: users + selected_network_id
ALTER TABLE "users" ADD COLUMN "selected_network_id" TEXT;

UPDATE "users" SET "selected_network_id" = (
    SELECT "id" FROM "networks" WHERE "slug" = 'bsc_testnet'
) WHERE "selected_network_id" IS NULL;

ALTER TABLE "users" ALTER COLUMN "selected_network_id" SET NOT NULL;

ALTER TABLE "users"
    ADD CONSTRAINT "users_selected_network_id_fkey"
    FOREIGN KEY ("selected_network_id") REFERENCES "networks"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: user_network_addresses
CREATE TABLE "user_network_addresses" (
    "telegram_id" BIGINT NOT NULL,
    "network_id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_network_addresses_pkey" PRIMARY KEY ("telegram_id", "network_id")
);
CREATE UNIQUE INDEX "user_network_addresses_network_id_address_key"
    ON "user_network_addresses"("network_id", "address");

ALTER TABLE "user_network_addresses"
    ADD CONSTRAINT "user_network_addresses_telegram_id_fkey"
    FOREIGN KEY ("telegram_id") REFERENCES "users"("telegram_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_network_addresses"
    ADD CONSTRAINT "user_network_addresses_network_id_fkey"
    FOREIGN KEY ("network_id") REFERENCES "networks"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill user_network_addresses from existing users.address
INSERT INTO "user_network_addresses" ("telegram_id", "network_id", "address")
SELECT u."telegram_id",
       (SELECT "id" FROM "networks" WHERE "slug" = 'bsc_testnet'),
       u."address"
FROM "users" u;

-- Drop old single-address column
DROP INDEX IF EXISTS "users_address_key";
ALTER TABLE "users" DROP COLUMN "address";

-- AlterTable: pending_transfers + network_id
ALTER TABLE "pending_transfers" ADD COLUMN "network_id" TEXT;

UPDATE "pending_transfers" SET "network_id" = (
    SELECT "id" FROM "networks" WHERE "slug" = 'bsc_testnet'
) WHERE "network_id" IS NULL;

ALTER TABLE "pending_transfers" ALTER COLUMN "network_id" SET NOT NULL;

ALTER TABLE "pending_transfers"
    ADD CONSTRAINT "pending_transfers_network_id_fkey"
    FOREIGN KEY ("network_id") REFERENCES "networks"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
