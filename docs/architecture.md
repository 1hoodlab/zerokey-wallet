# ZeroKey Wallet MVP-A Architecture

## Process Boundary

MVP-A runs as a single NestJS non-HTTP process created with
`createApplicationContext()`. The process owns Telegram long polling, config
validation, Prisma persistence, wallet SDK calls, and transfer orchestration.

The trust boundary is the server process. It holds `SERVER_EOA_PRIVATE_KEY`, so
any server compromise can control all MVP-A smart accounts.

## Modules

| Module           | Path                | Responsibility                               |
| ---------------- | ------------------- | -------------------------------------------- |
| `AppModule`      | `src/app.module.ts` | Root composition                             |
| `ConfigModule`   | `src/config/`       | `.env` loading and Joi validation            |
| `DatabaseModule` | `src/database/`     | Prisma client lifecycle                      |
| `WalletModule`   | `src/wallet/`       | Pimlico bundler and BSC testnet USDC access |
| `AccountModule`  | `src/account/`      | Deterministic user account persistence       |
| `OtpModule`      | `src/otp/`          | OTP generation, hashing, expiry, retry math  |
| `TransferModule` | `src/transfer/`     | OTP-gated transfer state machine             |
| `BotModule`      | `src/bot/`          | grammY bot lifecycle and command handlers    |

## Command Flows

### `/start`

1. `BotService` routes the private-chat command to `handleStart`.
2. `AccountService.getOrCreate()` looks up the Telegram user.
3. If missing, `WalletService.deriveAddress()` computes the deterministic smart account address.
4. Prisma stores the Telegram id and address.
5. The bot replies with the testnet warning and address.

### `/address`

1. `AccountService.getOrCreate()` returns the deterministic address.
2. The handler renders a QR PNG with `qrcode`.
3. The bot sends QR plus text address.

### `/balance`

1. `AccountService.getOrCreate()` returns the address.
2. `WalletService.getUsdcBalance()` reads BSC testnet USDC `balanceOf`.
3. The handler formats six-decimal USDC and replies.

### `/send`

1. The handler validates amount, recipient address, zero address, own address, and balance.
2. `TransferService.initiate()` cancels older pending transfers and stores a new `AWAITING_OTP` row.
3. The bot replies with the OTP challenge.
4. The OTP text handler calls `TransferService.confirm()`.
5. Valid OTP moves the row through `BROADCASTING` to `SUBMITTED` and calls `WalletService.sendUsdc()`.
6. `TransferService` emits transfer status events, and `BotService` sends follow-up messages.

`telegramId === chatId` is only assumed because `BotService` rejects non-private chats.
