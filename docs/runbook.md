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

## Refill Server EOA Gas

1. Derive the server EOA address from `SERVER_EOA_PRIVATE_KEY` using a local wallet tool.
2. Send Base Sepolia ETH from a faucet to that address.
3. Restart the bot if transfer failures were caused by an empty EOA.

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
- `Wallet operation failed after retry`: RPC, bundler, or Rhinestone path failed.
- EOA gas errors: refill the server EOA with Base Sepolia ETH.

## Wallet Integration Tests

`src/wallet/wallet.integration.spec.ts` is skipped unless funded testnet credentials
are provided:

```bash
TEST_SERVER_EOA_PRIVATE_KEY="0x..."
TEST_RHINESTONE_API_KEY="..."
TEST_BASE_SEPOLIA_RPC_URL="https://sepolia.base.org"
TEST_USDC_ADDRESS_BASE_SEPOLIA="0x036CbD53842c5426634e7929541eC2318f3dCF7e"
pnpm test:integration
```

The integration gate remains blocked until a funded Base Sepolia EOA and
Rhinestone API key are available.

## Manual Smoke Test

1. Start the bot with `pnpm start:dev`.
2. In a private Telegram chat, send `/start`; expect a valid `0x` address.
3. Send `/start` again; expect the same address.
4. Send `/address`; expect QR image and text address.
5. Fund the address with Base Sepolia USDC and required ETH.
6. Send `/balance`; expect current USDC amount.
7. Send `/send 0.1 0x0000000000000000000000000000000000000001`; expect OTP challenge.
8. Reply with the OTP; expect submitted transaction and later status message.
9. Start another send and reply wrong OTP three times; expect cancellation.
10. Start another send and wait more than 5 minutes; expect expiry when confirming.
