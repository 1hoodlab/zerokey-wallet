# zerokey-wallet

ZeroKey Wallet MVP-A is a custodial Telegram wallet bot for Base Sepolia USDC. It
creates deterministic per-user smart account addresses, reads balances, and sends
USDC after OTP confirmation in the Telegram chat.

## Quick Start

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres
pnpm prisma migrate dev --name init
pnpm start:dev
```

Before starting the bot, edit `.env` with a Telegram bot token, a funded Base
Sepolia server EOA private key, and a Rhinestone API key.

## Commands

- `/start` creates or shows your testnet wallet address.
- `/address` returns your address as text and QR code.
- `/balance` shows your Base Sepolia USDC balance.
- `/send <amount> <0x-address>` starts an OTP-confirmed USDC transfer.
- `/help` lists supported commands.

## Security Disclosure

- MVP-A is custodial on Base Sepolia testnet only.
- The bot server holds all keys; server compromise can drain all wallets.
- OTP is sent through the same Telegram chat and prevents typos, not Telegram account takeover.
- There is no recovery flow; losing Telegram account access can lose wallet access.
- Only USDC on Base Sepolia is supported.
- Gas is not sponsored; users need Base Sepolia ETH.
- Do not use MVP-A on mainnet.
