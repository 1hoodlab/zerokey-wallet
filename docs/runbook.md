# ZeroKey Wallet MVP-A Runbook

## Start Postgres

```bash
docker compose up -d postgres
```

If this fails with `Cannot connect to the Docker daemon`, start Docker Desktop or
the local Docker daemon, then rerun the command.

## Run Migrations

```bash
pnpm prisma migrate dev --name init
pnpm prisma generate
```

Prisma 7 reads `DATABASE_URL` from `prisma.config.ts`, so keep `.env` populated
before running CLI commands.

After schema changes, apply migrations and refresh seeds when needed:

```bash
pnpm prisma migrate deploy
pnpm prisma db seed
```

## Network configuration

RPC URLs, chain IDs, and USDC contract addresses live in the `networks` table.
Rows are maintained in `prisma/seed.ts` (upsert by `slug`). Edit that file and run:

```bash
pnpm prisma db seed
```

The bot caches viem HTTP transports per `chain_id` for the lifetime of the process;
restart the bot after changing an `rpc_url`.

## Refill Smart Account Gas

1. Use `/address` to get the user's smart account address.
2. Send BSC testnet BNB from a faucet to that address.
3. Retry the transfer if failures were caused by an empty smart account.

Never paste `SERVER_EOA_PRIVATE_KEY` into logs, tickets, or shared chats.

## Query Stuck Transfers

Use Prisma Studio:

```bash
pnpm prisma studio
```

Or query Postgres directly:

```sql
SELECT id, telegram_id, recipient, amount, status, tx_hash, created_at, confirmed_at
FROM pending_transfers
WHERE status IN ('AWAITING_OTP', 'BROADCASTING', 'SUBMITTED', 'FAILED', 'TIMEOUT')
ORDER BY created_at DESC;
```

## Inspect Logs

Look for these cases:

- `FAILED`: broadcast or wallet SDK call failed.
- `TIMEOUT`: receipt polling did not complete in the expected window.
- `Wallet operation failed after retry`: RPC, bundler, or Pimlico path failed.
- Smart account gas errors: refill the user's smart account with BSC testnet BNB.

## Wallet Integration Tests

`src/wallet/wallet.integration.spec.ts` is skipped unless funded credentials **and**
a seeded database are provided. Chain metadata (`rpc_url`, `chain_id`, `usdc_address`)
comes from the `networks` row selected by `TEST_NETWORK_SLUG`:

```bash
DATABASE_URL="postgresql://..."
TEST_SERVER_EOA_PRIVATE_KEY="0x..."
TEST_PIMLICO_API_KEY="..."
TEST_NETWORK_SLUG="bsc_testnet"
pnpm test:integration
```

Apply migrations and seed before running integration tests:

```bash
pnpm prisma migrate deploy
pnpm prisma db seed
```

## Manual Smoke Test

1. Start the bot with `pnpm start:dev`.
2. In a private Telegram chat, send `/start`; expect a valid `0x` address.
3. Send `/start` again; expect the same address.
4. Send `/address`; expect QR image and text address.
5. Fund the address with BSC testnet USDC and required BNB for gas.
6. Send `/balance`; expect current USDC amount.
7. Send `/networks`; expect at least one enabled network with `[current]` on your slug.
8. Send `/switch bsc_testnet`; expect confirmation with chain id and address.
9. Send `/send 0.1 0x0000000000000000000000000000000000000001`; expect OTP challenge.
10. Reply with the OTP; expect submitted transaction and later status message.
11. Start another send and reply wrong OTP three times; expect cancellation.
12. Start another send and wait more than 5 minutes; expect expiry when confirming.
