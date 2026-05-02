# ZeroKey Wallet — MVP-A Design Spec

- **Ngày**: 2026-05-02
- **Status**: Draft for review
- **Project**: zerokey-wallet
- **Scope**: Sub-project A (MVP testnet)
- **Target chain**: Base Sepolia
- **Target token**: USDC (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`)

---

## 1. Bối cảnh và mục tiêu

ZeroKey Wallet là Telegram bot cho phép user tạo địa chỉ ví và gửi USDC qua command bot, không cần quản lý seed phrase, không cần install MetaMask, không cần Mini App. Bot ký giao dịch hộ user sau khi user xác nhận bằng OTP gửi qua chính chat Telegram.

Tên "zerokey" hàm ý user không phải quản lý key; thực tế MVP-A là **custodial** (team giữ tất cả keys). Roadmap tiến tới true non-custodial nằm ở Sub-project C (xem mục 10).

MVP-A là **subset đầu tiên** của lộ trình tổng thể; được tách riêng để validate giả định cốt lõi (Rhinestone SDK + grammY + flow OTP) trước khi đầu tư vào Sub-project B (recovery) và C (mainnet hardening).

### Mục tiêu rõ ràng

- User có thể `/start` → nhận address USDC trên Base Sepolia
- User có thể `/balance` xem số USDC
- User có thể `/send <amount> <address>` để gửi, xác nhận bằng OTP 6 chữ số trong chat
- Bot deploy được trên VPS một process, dùng long-polling
- Code structure đủ sạch để Sub-project B/C xây tiếp mà không refactor lớn

### Phi mục tiêu

- KHÔNG trong MVP-A:
    - Recovery / guardians (defer Sub-project B)
    - Multisig với key isolation (defer Sub-project B)
    - Smart Sessions on-chain rate limit (defer)
    - Sponsored gas (user dùng faucet ETH testnet)
    - Multi-token (chỉ USDC)
    - Intra-bot `@username` transfer
    - Mainnet
    - Production key management (KMS/HSM)
    - Real MFA (OTP cùng kênh Telegram = anti-typo only)
    - Sentry / external alerting
    - Webhook deployment

---

## 2. Quyết định nền tảng (decisions log)

| # | Decision | Lý do |
|---|---|---|
| D1 | Custody: **custodial với bot ký hộ**, OTP cùng kênh Telegram | User chọn — minimal friction, testnet không có tiền thật |
| D2 | Multisig: **1-of-1 single server EOA** sở hữu tất cả smart accounts | Multisig cùng-server là security theater; defer key isolation sang Sub-project C |
| D3 | Per-user account derivation: `nonce = telegramId` | Rhinestone SDK hỗ trợ sẵn, tránh quản lý nhiều EOAs |
| D4 | Daily cap: **không có** trong MVP-A | User chọn no cap; nếu cần sau, dễ thêm server-side counter |
| D5 | Smart Sessions: **không dùng** | API experimental, breaking changes; server-side checks đủ cho MVP |
| D6 | Deployment timing: **counterfactual** (lazy) | Free `/start`, deploy bundled vào first `/send` |
| D7 | Token scope: **chỉ USDC** Base Sepolia | Có Circle faucet, đủ cho demo |
| D8 | Recipient: **chỉ external 0x address** | Defer `@username` transfer |
| D9 | Framework: **NestJS 11** non-HTTP (`createApplicationContext`) | DI/module structure cho Sub-project B/C; bỏ HTTP layer thừa |
| D10 | DB: **Postgres 16 + Prisma 7**, docker-compose local | Production-bound choice, tránh migrate từ SQLite sau |
| D11 | OTP: 6-digit numeric, TTL 5 phút, max 3 retries | Standard pattern, đủ cho anti-typo |
| D12 | Logging: Pino qua `nestjs-pino` | Structured JSON, redact secrets |
| D13 | Bot transport: **long-polling** | Không cần SSL/domain cho MVP testnet; webhook defer Sub-project C |

---

## 3. Architecture overview

Một process duy nhất, single trust zone.

```
┌─────────────────────────────────────────────────────────────────┐
│                     Node.js process                              │
│                                                                  │
│  ┌──────────────┐   ┌──────────────┐    ┌──────────────────┐    │
│  │   grammY     │──▶│  Bot Logic   │───▶│  Rhinestone SDK  │    │
│  │  (long-poll) │   │  (handlers,  │    │  (sign + send)   │    │
│  │              │   │   OTP gate)  │    │                  │    │
│  └──────────────┘   └──────┬───────┘    └────────┬─────────┘    │
│                            │                     │              │
│                            ▼                     ▼              │
│                    ┌──────────────┐    ┌──────────────────┐     │
│                    │  Postgres    │    │  Server EOA      │     │
│                    │  (Prisma)    │    │  (env var,       │     │
│                    │              │    │   single owner   │     │
│                    │              │    │   for all SAs)   │     │
│                    └──────────────┘    └────────┬─────────┘     │
└─────────────────────────────────────────────────┼───────────────┘
                                                  │
                                                  ▼
                                        ┌──────────────────┐
                                        │  Base Sepolia    │
                                        │  (RPC + Bundler  │
                                        │   via Rhinestone │
                                        │   Orchestrator)  │
                                        └──────────────────┘
```

**Trust boundary**: tất cả keys + DB + bot logic nằm trong **một** trust zone (Node.js process). Nếu process bị compromise → tất cả wallets drainable. Đây là điều đã chấp nhận cho MVP testnet (D1, D2). README phải cảnh báo rõ.

---

## 4. Components & module boundaries

8 modules NestJS, mỗi module 1 thư mục, có boundary rõ.

| NestJS Module | Path | Trách nhiệm | Phụ thuộc |
|---|---|---|---|
| `AppModule` | `src/app.module.ts` | Root composition | tất cả |
| `ConfigModule` | `@nestjs/config` | Load `.env`, validate `joi` schema | `joi` |
| `DatabaseModule` | `src/database/` | `PrismaService extends PrismaClient` với lifecycle hooks | `@prisma/client` |
| `WalletModule` | `src/wallet/` | Wrap `@rhinestone/sdk`. Anti-corruption layer cho SDK experimental | `@rhinestone/sdk`, `viem` |
| `AccountModule` | `src/account/` | `getOrCreate(telegramId)`: derive deterministic address | `WalletModule`, `DatabaseModule` |
| `OtpModule` | `src/otp/` | Generate/verify/expire OTP | `DatabaseModule` |
| `TransferModule` | `src/transfer/` | Orchestrate `/send` flow + background poll | `WalletModule`, `OtpModule`, `DatabaseModule`, `EventEmitterModule` |
| `BotModule` | `src/bot/` | grammY service + handlers + lifecycle | `AccountModule`, `TransferModule`, `OtpModule`, `EventEmitterModule` |

**Entry point** `src/main.ts`:

```ts
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  process.on('SIGTERM', () => app.close());
}
bootstrap();
```

Dùng `createApplicationContext()` (non-HTTP) — không load Express/Fastify thừa. Sub-project C có thể chuyển sang `create()` khi thêm webhook.

**Boundary enforcement** qua import discipline:
- `BotModule` → chỉ import `AccountModule`, `TransferModule`, `OtpModule`
- `TransferModule` → import `WalletModule`, `OtpModule`, `DatabaseModule`
- `WalletModule` → chỉ phụ thuộc SDK + config (không biết DB, không biết bot)
- `DatabaseModule` → chỉ phụ thuộc Prisma + config

Cô lập đủ để test `TransferService` với mock `WalletService` + mock Prisma, không cần real Sepolia hay real Telegram.

**Decoupling Transfer → Bot**: dùng `@nestjs/event-emitter`. Transfer emit event `transfer.confirmed` / `transfer.failed`, Bot lắng và gửi follow-up message qua grammY API. Tránh circular dependency.

**Private chats only**: Bot middleware reject mọi update không phải private chat (groups, channels, supergroups). Constraint này có 2 lý do: (1) bot không thiết kế cho UX nhiều user một chat; (2) cho phép giả định bất biến `telegramId === chatId` — đơn giản hoá việc gửi follow-up message từ background poll mà không cần lưu `chat_id` riêng. Nếu Sub-project C cần group features, phải redesign.

---

## 5. Data flow

### 5.1 — `/start`

```
User → /start
  ├─ AccountService.getOrCreate(telegramId)
  │    ├─ Prisma: SELECT user WHERE telegram_id = ? → if exists: return
  │    ├─ WalletService.deriveAddress(nonce = telegramId)
  │    ├─ Prisma: INSERT user (telegram_id, address, created_at)
  │    └─ return { address, isNew: true }
  └─ ctx.reply("Welcome! Address: 0x... Send USDC here, then /balance and /send.")
```

Không deploy on-chain. Chỉ tính địa chỉ deterministic qua `getAddress()` của SDK.

Idempotent: re-run `/start` trả cùng address.

### 5.2 — `/address`

```
User → /address
  ├─ AccountService.getOrCreate(telegramId)
  └─ ctx.replyWithPhoto(qrCode(address), { caption: address })
```

Gửi QR PNG (qua `qrcode` lib) + text address.

### 5.3 — `/balance`

```
User → /balance
  ├─ AccountService.getOrCreate(telegramId)
  ├─ WalletService.getUSDCBalance(address)  // viem readContract
  └─ ctx.reply(`${formatUnits(balance, 6)} USDC`)
```

### 5.4 — `/send <amount> <address>` (flow phức tạp nhất)

**Phase 1 — Initiate**

```
User → /send 10 0xabc...
  ├─ Validate: amount > 0, recipient là 0x address hợp lệ
  ├─ AccountService.getOrCreate(telegramId)
  ├─ WalletService.getUSDCBalance() ≥ amount? else "insufficient"
  ├─ TransferService.initiate(telegramId, recipient, amount)
  │    ├─ Prisma: UPDATE pending_transfers SET status='CANCELLED'
  │    │         WHERE telegram_id=? AND status='AWAITING_OTP'
  │    ├─ const transferId = crypto.randomUUID()
  │    ├─ const code = OtpService.generate(transferId) → 6-digit
  │    ├─ Prisma: INSERT pending_transfers (..., otp_hash=sha256(code), status='AWAITING_OTP')
  │    └─ return { transferId, code }
  └─ ctx.reply("Confirm: 10 USDC → 0xabc...\nReply with: 142857\n(5 min)")
```

**Phase 2 — Confirm (user reply 6-digit code)**

Bot middleware lắng mọi text message; nếu match `/^\d{6}$/`:

```
User → 142857
  ├─ TransferService.confirm(telegramId, code)
  │    ├─ Prisma: SELECT pending WHERE telegram_id=? AND status='AWAITING_OTP'
  │    │    └─ none → throw NoPendingTransferError
  │    ├─ if created_at > 5min ago:
  │    │    UPDATE status='EXPIRED'
  │    │    throw OtpExpiredError
  │    ├─ if otp_hash !== sha256(code):
  │    │    UPDATE retry_count++
  │    │    if retry_count >= 3: UPDATE status='CANCELLED'; throw TooManyOtpAttemptsError
  │    │    else: throw OtpInvalidError(retriesLeft)
  │    ├─ UPDATE status='BROADCASTING'
  │    ├─ ctx.reply("Submitting…")
  │    ├─ const { hash } = await WalletService.sendUSDC(account, recipient, amount)
  │    ├─ UPDATE status='SUBMITTED', tx_hash=hash
  │    ├─ ctx.reply("Submitted! Tx: 0xdef… (explorer link)")
  │    └─ this.pollReceipt(transferId, hash)  // fire-and-forget; chatId derived from DB
```

**Phase 3 — Background confirmation**

`pollReceipt` được fire-and-forget từ `confirm()` (không await). Vì invariant private-chats-only (Section 4), `chatId` luôn bằng `telegramId` của row pending_transfer — không cần truyền tham số riêng:

```ts
async pollReceipt(transferId: string, hash: Hex) {
  const pending = await prisma.pendingTransfer.findUnique({ where: { id: transferId } })
  const chatId = pending.telegramId  // private chat invariant
  try {
    await account.waitForTransactionReceipt({ hash, timeout: 60_000 })
    await prisma.pendingTransfer.update({ where: { id: transferId },
      data: { status: 'CONFIRMED', confirmedAt: new Date() } })
    eventEmitter.emit('transfer.confirmed', { chatId, hash })
  } catch (e) {
    await prisma.pendingTransfer.update({ where: { id: transferId },
      data: { status: e.code === 'TIMEOUT' ? 'TIMEOUT' : 'FAILED' } })
    eventEmitter.emit('transfer.failed', { chatId, hash, reason: e.message })
  }
}
```

`BotService` listen:

```ts
@OnEvent('transfer.confirmed')
onConfirmed({ chatId, hash }) { bot.api.sendMessage(chatId, `Confirmed: ${hash}`) }

@OnEvent('transfer.failed')
onFailed({ chatId, hash, reason }) { bot.api.sendMessage(chatId, `Failed: ${reason}`) }
```

### 5.5 — `/help`

Static text reply với danh sách command.

### 5.6 — Error matrix `/send`

| Trường hợp | Xử lý |
|---|---|
| Args sai format | Reply usage |
| Address không hợp lệ | Reply "Invalid address" |
| Recipient = ZeroAddress | Reject |
| Recipient = own address | Reject |
| Balance không đủ | Reply "Insufficient USDC" |
| OTP đã có pending khác | Cancel pending cũ, tạo mới |
| OTP sai 3 lần | Cancel toàn bộ flow |
| OTP hết hạn 5 phút | Reply expired (lazy check) |
| Broadcast fail (RPC/Bundler) | Reply error, status='FAILED' |
| Receipt timeout 60s | Reply "Pending — check explorer", status='TIMEOUT', không retry |

### 5.7 — Database schema

`prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  telegramId BigInt   @id @map("telegram_id")
  address    String   @unique
  createdAt  DateTime @default(now()) @map("created_at")
  transfers  PendingTransfer[]

  @@map("users")
}

model PendingTransfer {
  id          String         @id @default(uuid())
  telegramId  BigInt         @map("telegram_id")
  user        User           @relation(fields: [telegramId], references: [telegramId])
  recipient   String
  amount      String
  otpHash     String         @map("otp_hash")
  retryCount  Int            @default(0) @map("retry_count")
  status      TransferStatus
  txHash      String?        @map("tx_hash")
  createdAt   DateTime       @default(now()) @map("created_at")
  confirmedAt DateTime?      @map("confirmed_at")

  @@index([telegramId, status])
  @@map("pending_transfers")
}

enum TransferStatus {
  AWAITING_OTP
  BROADCASTING
  SUBMITTED
  CONFIRMED
  TIMEOUT
  FAILED
  EXPIRED
  CANCELLED
}
```

**Quy ước**:
- `telegramId` dùng `BigInt` vì Telegram user IDs có thể vượt 2^31
- `amount` lưu dạng `String` (bigint base unit) để tránh precision loss với JS `number`
- Status dùng Postgres native enum

---

## 6. Error handling

### 6.1 — Validation (handler layer)

Reject sớm trước khi gọi service. Reply usage hint.

| Lỗi | Reply |
|---|---|
| `/send` thiếu args | `Usage: /send <amount> <0x-address>` |
| Amount không phải số / ≤ 0 | Phù hợp |
| Address không hợp lệ | "Invalid Ethereum address" |
| Recipient = ZeroAddress / own / bot | Phù hợp |

Validation dùng `class-validator` + viem helpers (`isAddress`, `parseUnits`).

### 6.2 — Typed exceptions (service layer)

`src/common/exceptions.ts`:

```ts
export class InsufficientBalanceError extends Error {}
export class NoPendingTransferError extends Error {}
export class OtpExpiredError extends Error {}
export class OtpInvalidError extends Error {
  constructor(public retriesLeft: number) { super('Invalid OTP') }
}
export class TooManyOtpAttemptsError extends Error {}
```

Bot handler bắt từng loại → format message phù hợp. Unknown exception bubble lên global handler.

### 6.3 — Wallet/SDK errors

Wrap trong `WalletService`, map raw SDK errors sang typed exceptions của ta:

| Loại | Action |
|---|---|
| Bundler 4xx/5xx | Retry 1 lần với delay 2s, fail → "Network busy" |
| RPC timeout | Retry 1 lần |
| Contract revert | Reply revert reason |
| Server EOA out of gas | CRITICAL log, reply "Service temporarily unavailable" |
| Account not deployed (counterfactual) | Expected — SDK tự bundle deploy+execute |
| Unknown SDK error | Reply "Service error", log full stack |

### 6.4 — Database errors (Prisma)

| Code | Action |
|---|---|
| `P2002` (unique violation) | Re-fetch + return existing (idempotent) |
| `P1001` (DB unreachable) | Reply "Service unavailable", CRITICAL log |
| `P2025` (record not found) | Throw, ERROR log (logic bug) |

Không retry tự động.

### 6.5 — Global error boundaries

grammY error handler trong `BotService`:

```ts
bot.catch((err) => {
  logger.error({ err, ctx: err.ctx?.update }, 'Unhandled bot error')
  err.ctx?.reply('Something went wrong. Try again or /help.').catch(() => {})
})
```

Process-level:

```ts
process.on('uncaughtException', (e) => { logger.fatal(e); process.exit(1) })
process.on('unhandledRejection', (e) => { logger.fatal(e); process.exit(1) })
```

### 6.6 — Logging

Pino qua `nestjs-pino`. Levels: INFO (commands, transfers), WARN (validation rejected, retries), ERROR (SDK/RPC/DB failures), FATAL (uncaught, EOA out of gas).

Auto-redact:

```ts
redact: ['*.privateKey', '*.otp', '*.otpHash', 'req.headers.authorization']
```

Không log: OTP code (chỉ otp_hash), server EOA private key, bot token.

---

## 7. Testing strategy

### 7.1 — Unit tests (Jest)

Mock SDK + DB qua NestJS `Test.createTestingModule`. Coverage target **80%+ trên services**, **50% trên bot handlers**.

| Service | Cases chính |
|---|---|
| `OtpService` | Generate khác nhau, hash đúng, verify match/mismatch, expiry, retry counter, max retries cancel |
| `AccountService` | Idempotent `getOrCreate`, nonce khác nhau cho telegram_id khác nhau, address deterministic |
| `TransferService` | `initiate` cancel pending cũ, OTP gắn đúng, confirm happy/wrong/expired, broadcast fail, concurrency 2 `/send` cùng user |

Time mock cho expiry: `jest.useFakeTimers()`.

### 7.2 — Integration tests (real Sepolia, opt-in)

Target `WalletService`. Tag `describe('@integration', ...)`, chạy qua `pnpm test:integration`. Không chạy mỗi PR.

Setup `.env.test` với `TEST_SERVER_EOA_PRIVATE_KEY` (key riêng pre-funded ETH testnet).

Cases: `deriveAddress` deterministic, `sendUSDC` happy path, insufficient balance throws, `getUSDCBalance` chính xác.

### 7.3 — E2E smoke test (manual, 1 case)

`docker compose up postgres` → bot run với test bot token → dev gõ `/start`, `/send 0.1 0xabc`, gõ OTP → thấy "Confirmed".

Chạy thủ công trước khi merge feature lớn. Không tự động trong CI.

### 7.4 — Implementation discipline

Khi viết code, follow TDD cho `TransferService` (logic phức tạp với nhiều edge case). Với `WalletService`, integration test trước PR là đủ — không strict TDD vì test slow.

---

## 8. Tech stack & setup

### 8.1 — Runtime & toolchain

| Item | Choice |
|---|---|
| Runtime | Node.js LTS (≥22, recommend 24) |
| Language | TypeScript 6 (strict mode) |
| Package manager | pnpm 9+ |
| Linter | ESLint 10 + `@typescript-eslint` |
| Formatter | Prettier 3 |
| Git hooks | Husky + lint-staged |

### 8.2 — Dependencies (snapshot 2026-05-02)

`dependencies`:

```jsonc
{
  "@nestjs/common": "^11.1.19",
  "@nestjs/core": "^11.1.19",
  "@nestjs/config": "^4.0.4",
  "@nestjs/event-emitter": "^3.1.0",
  "@prisma/client": "^7.8.0",
  "grammy": "^1.42.0",
  "@rhinestone/sdk": "^1.5.1",
  "viem": "^2.48.8",
  "nestjs-pino": "^4.6.1",
  "pino-pretty": "^13.1.3",
  "class-validator": "^0.15.1",
  "class-transformer": "^0.5.1",
  "joi": "^18.1.2",
  "qrcode": "^1.5.4",
  "reflect-metadata": "^0.2.2",
  "rxjs": "^7.8.2"
}
```

`devDependencies`:

```jsonc
{
  "@nestjs/testing": "^11.1.19",
  "@types/jest": "^30.0.0",
  "@types/node": "^25.6.0",
  "@types/qrcode": "^1.5.6",
  "eslint": "^10.3.0",
  "husky": "^9.1.7",
  "jest": "^30.3.0",
  "lint-staged": "^16.4.0",
  "prettier": "^3.8.3",
  "prisma": "^7.8.0",
  "ts-jest": "^29.4.9",
  "ts-node": "^10.9.2",
  "tsx": "^4.21.0",
  "typescript": "^6.0.3"
}
```

`engines`:

```jsonc
{ "node": ">=22" }
```

`uuid` package được thay bằng `crypto.randomUUID()` (Node 22+ built-in).

**Verification gate trước implementation**: chạy `pnpm install` đầu tiên. Nếu peer-dep conflict (TS 6 vs NestJS 11, Prisma 7 vs các package), downgrade theo install log. Spec này dùng version hiện hành lúc ngày 2026-05-02.

### 8.3 — Project structure

```
zerokey-wallet/
├── docker-compose.yml          # Postgres
├── .env.example                # Committed template
├── .env                        # Gitignored secrets
├── prisma/
│   └── schema.prisma
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── common/
│   │   ├── exceptions.ts
│   │   └── events.ts
│   ├── config/
│   │   ├── config.module.ts
│   │   └── env.schema.ts
│   ├── database/
│   │   ├── database.module.ts
│   │   └── prisma.service.ts
│   ├── wallet/
│   │   ├── wallet.module.ts
│   │   └── wallet.service.ts
│   ├── account/
│   │   ├── account.module.ts
│   │   └── account.service.ts
│   ├── otp/
│   │   ├── otp.module.ts
│   │   └── otp.service.ts
│   ├── transfer/
│   │   ├── transfer.module.ts
│   │   └── transfer.service.ts
│   └── bot/
│       ├── bot.module.ts
│       ├── bot.service.ts
│       └── handlers/
│           ├── start.handler.ts
│           ├── address.handler.ts
│           ├── balance.handler.ts
│           ├── send.handler.ts
│           ├── otp.handler.ts
│           └── help.handler.ts
└── test/
    ├── fixtures/
    └── jest-e2e.json
```

### 8.4 — Configuration

`.env.example`:

```bash
DATABASE_URL="postgresql://zerokey:zerokey_local@localhost:5432/zerokey_wallet"
BOT_TOKEN="1234567:ABC..."
SERVER_EOA_PRIVATE_KEY="0x..."
RHINESTONE_API_KEY=""
BASE_SEPOLIA_RPC_URL="https://sepolia.base.org"
USDC_ADDRESS_BASE_SEPOLIA="0x036CbD53842c5426634e7929541eC2318f3dCF7e"
OTP_TTL_SECONDS=300
OTP_MAX_RETRIES=3
LOG_LEVEL="info"
NODE_ENV="development"
```

Schema validation `joi` trong `src/config/env.schema.ts` — fail fast lúc bootstrap nếu thiếu/sai env.

### 8.5 — `docker-compose.yml`

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: zerokey
      POSTGRES_PASSWORD: zerokey_local
      POSTGRES_DB: zerokey_wallet
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U zerokey"]
      interval: 5s
      retries: 10
volumes:
  pgdata:
```

### 8.6 — Local dev workflow

```bash
pnpm install
cp .env.example .env
# edit .env: BOT_TOKEN, SERVER_EOA_PRIVATE_KEY
docker compose up -d postgres
pnpm prisma migrate dev --name init
pnpm prisma generate
pnpm start:dev
```

### 8.7 — Documentation deliverables

| File | Content |
|---|---|
| `README.md` | Quick start (3 commands), tech overview, **security disclosure**: testnet only, custodial, list known limitations |
| `docs/architecture.md` | Diagrams Section 3+4 |
| `docs/runbook.md` | Ops: refill EOA gas, view logs, query stuck transfer |
| `docs/superpowers/specs/2026-05-02-zerokey-wallet-mvp-a-design.md` | This spec |

---

## 9. Security disclosure (must be in README)

MVP-A là **custodial trên Base Sepolia testnet**. Limitations:

- Bot server giữ tất cả keys; nếu server bị compromise, tất cả user wallets drainable
- OTP qua Telegram cùng kênh chat → chống typo, KHÔNG chống Telegram account takeover
- Không có recovery flow; mất Telegram account = mất ví
- Chỉ hỗ trợ USDC trên Base Sepolia
- Không sponsor gas; user phải tự lấy ETH testnet từ Coinbase faucet

Mainnet hardening (KMS, multisig, recovery, MFA thật) là Sub-project C. KHÔNG dùng MVP-A trên mainnet.

---

## 10. Roadmap forward

| Sub-project | Scope | Trigger |
|---|---|---|
| **B** | Recovery với guardians (Rhinestone Recovery module). Chú ý gap không-timelock của built-in module — có thể cần custom timelock module hoặc ghi rõ limitation. | Sau khi MVP-A demo end-to-end OK trên Sepolia |
| **C** | Mainnet hardening: WebAuthnValidator (passkey), key isolation (KMS/HSM), webhook deployment, Sentry/alerting, rate limiting, sponsored gas (Rhinestone paymaster), validator rotation từ 1-of-1 sang 2-of-N | Sau B |

Sub-project A để cấu trúc code (modules, validator stack) sao cho B và C có thể build tiếp **không phải redeploy** smart accounts (Rhinestone hỗ trợ rotate validators on-chain).

---

## 11. Acceptance criteria của MVP-A

- [ ] `pnpm install && docker compose up && pnpm start:dev` chạy được không error
- [ ] `/start` trả về 0x address hợp lệ
- [ ] `/start` lần 2 cùng telegram user trả về cùng address
- [ ] `/address` gửi QR code + text address
- [ ] `/balance` query đúng số USDC trên Sepolia
- [ ] `/send 0.1 <addr>` flow: validate → OTP → confirm → broadcast → status update qua event
- [ ] OTP sai 3 lần → cancel transfer
- [ ] OTP hết 5 phút → expired
- [ ] `/send` lúc đang có pending → cancel pending cũ
- [ ] Unit test coverage ≥ 80% trên `OtpService`, `AccountService`, `TransferService`
- [ ] Integration test `WalletService` pass trên real Sepolia
- [ ] E2E smoke test thủ công pass
- [ ] README có security disclosure mục 9
- [ ] Bot run liên tục 24h không crash với tải nhẹ (< 100 user)
