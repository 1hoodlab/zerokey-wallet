# zerokey-wallet

ZeroKey Wallet MVP-A is a custodial Telegram wallet bot for BSC testnet USDC. It
creates deterministic per-user smart account addresses, reads balances, and sends
USDC after OTP confirmation in the Telegram chat.

## Quick Start

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres
pnpm prisma migrate dev --name init
pnpm prisma db seed
pnpm start:dev
```

Before starting the bot, edit `.env` with a Telegram bot token, a funded server EOA private key for signing Safe AA ops, and a Pimlico API key. Supported chains and token contracts come from the `networks` table via `pnpm prisma db seed`.

## Commands

- `/start` creates or shows your wallet address on the default network (`bsc_testnet`).
- `/address` returns your address as text and QR code for your **current** network.
- `/balance` shows USDC balance on your current network.
- `/send <amount> <0x-address>` starts an OTP-confirmed USDC transfer on your current network.
- `/networks` lists enabled networks and marks your current selection.
- `/switch <slug>` changes your active network (addresses may differ per chain).
- `/help` lists supported commands.

## Security Disclosure

- MVP-A is custodial on BSC testnet only.
- The bot server holds all keys; server compromise can drain all wallets.
- OTP is sent through the same Telegram chat and prevents typos, not Telegram account takeover.
- There is no recovery flow; losing Telegram account access can lose wallet access.
- Only USDC on BSC testnet is supported (configurable token address).
- Gas is not sponsored; smart accounts need BNB on BSC testnet for gas.
- Do not use MVP-A on mainnet.
