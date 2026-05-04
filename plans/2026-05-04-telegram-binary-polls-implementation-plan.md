# Telegram binary polls (parimutuel) — Implementation Plan

> **For agentic workers:** Use **subagent-driven-development** or **executing-plans** to execute this checklist task-by-task. Steps below use `- [ ]` for tracking.

**Goal:** Implement Telegram commands for creator-driven **binary polls**, **VoteIntent**/OTP stakes to **`POLL_USDC_ESCROW_ADDRESS`**, **close-before-resolve**, **binary parimutuel** payouts, and **`/claim_poll`** disbursement **from escrow** (no claim OTP).

**Architecture:** NestJS **`PollModule`** owns Prisma-backed `Poll` / `VoteIntent` / `PollWinnerPayout`, pure **`allocateBinaryParimutuel`** helper, **`PollTransferConfirmedListener`** on `TRANSFER_CONFIRMED_EVENT` (+ `transferId` in payload) to finalize **only** stakes with `CONFIRMED` + validations, **`PollEscrowPayoutService`** for USDC **`transfer`** signed by **`POLL_ESCROW_PRIVATE_KEY`**. Bot handlers delegate to services.

**Tech Stack:** NestJS 11, Prisma + PostgreSQL, grammY, viem, Joi env, Jest (`pnpm exec jest`). Spec: `docs/superpowers/specs/2026-05-04-telegram-binary-polls-design.md`.

**Plan file location:** `plans/` matches existing repo convention (writing-plans default `docs/superpowers/plans/` overridden here).

---

## File structure (ownership)

| Path | Responsibility |
|------|------------------|
| `prisma/schema.prisma` | Enums + `Poll`, `VoteIntent`, `PollWinnerPayout`; relations `Network.polls`; optional `VoteIntent` ↔ `PendingTransfer` FK |
| `prisma/migrations/<ts>_telegram_binary_polls/` | SQL migration |
| `src/config/env.schema.ts` | `POLL_USDC_ESCROW_ADDRESS`, `POLL_ESCROW_PRIVATE_KEY` |
| `src/config/app-config.service.ts` | Expose validated escrow getters |
| `.env.example` | Document new vars |
| `src/common/events.ts` | `TransferStatusEvent` gains `transferId: string` |
| `src/transfer/transfer.service.ts` | Emit `transferId` on CONFIRMED/FAILED |
| `src/poll/allocate-binary-parimutuel.ts` | Pure payout math (+ dust note) |
| `src/poll/allocate-binary-parimutuel.spec.ts` | Unit tests |
| `src/poll/poll.service.ts` | CRUD/lifecycle `createPoll`, `getPollSummary`, `closePoll`, `resolvePoll` (+ auth checks creator) |
| `src/poll/vote-intent.service.ts` | `startDraftIntent`, `confirmDraftAndInitiateStake`, validations vs escrow/network |
| `src/poll/poll-transfer-confirmed.listener.ts` | On confirmed: locate `VoteIntent` by `pendingTransferId`, set `STAKE_CONFIRMED` + `stakeConfirmedAt` |
| `src/poll/poll-escrow-payout.service.ts` | ERC20.transfer from escrow EOA to SA user (`WalletService.deriveAddress`) |
| `src/poll/poll.module.ts` | `imports` Database, Config, Wallet, Transfer, Account, Network; `providers`; `exports` poll services listener needs |
| `src/app.module.ts` | `imports: [PollModule]` |
| `src/bot/handlers/poll.handlers.ts` (or split files) | `/create_poll`, `/poll`, `/vote_poll`, `/close_poll`, `/resolve_poll`, `/claim_poll` |
| `src/bot/handlers/help.handler.ts` | Add lines |
| `src/bot/bot.service.ts` | Register commands; inject poll services |

---

### Task 1: Prisma models and migration

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_telegram_binary_polls/migration.sql` (via `pnpm exec prisma migrate dev --name telegram_binary_polls`)

Add enums **`PollState`**, **`PollSide`**, **`VoteIntentStatus`**, **`PollPayoutStatus`** and models per design spec §7. Required points:

- `Poll.networkId` → `Network`; add `polls Poll[]` on **`Network`**.
- `VoteIntent`: `expiresAt`, `stakeConfirmedAt`, `pendingTransferId String? @unique` → **`PendingTransfer`**. Add on **`PendingTransfer`**: `voteIntent VoteIntent?` (inverse).
- **`PollWinnerPayout`**: `@@unique([pollId, telegramId])`, `status`, `paidAt`, `outboundTxHash`.
- Indexes: `VoteIntent` `[pollId, status]`, `[telegramId]`.

**Note:** Existing `Poll`/`PollSide` names may clash mentally with “polling” transports — keep Prisma enum names **`Poll`** as in spec (project domain).

---

### Task 2: Env validation and config service

**Files:**

- Modify: `src/config/env.schema.ts`
- Modify: `src/config/app-config.service.ts`
- Modify: `.env.example`

Extend Joi schema:

```typescript
import { getAddress, isAddress } from 'viem';

POLL_USDC_ESCROW_ADDRESS: Joi.string()
  .pattern(/^0x[a-fA-F0-9]{40}$/)
  .custom((hex: string, helpers) => {
    try {
      return getAddress(hex);
    } catch {
      return helpers.error('any.invalid');
    }
  })
  .required(),
POLL_ESCROW_PRIVATE_KEY: Joi.string()
  .pattern(/^0x[a-fA-F0-9]{64}$/)
  .required(),
```

In `AppConfigService`, getters **`pollUsdcEscrowAddress()`** returning checksum `0x`, **`pollEscrowPrivateKey()`** hex (never log).

**Operational:** escrow EOA must hold **native gas** + **incoming USDC** stakes on each supported chain (`docs/runbook.md` appendix one paragraph).

---

### Task 3: Transfer events carry `transferId`

**Files:**

- Modify: `src/common/events.ts`
- Modify: `src/transfer/transfer.service.ts`
- Modify: `src/bot/bot.service.ts` (@OnEvent handlers still work; widen type)

Extend interface:

```typescript
export interface TransferStatusEvent {
  chatId: bigint;
  transferId: string;
  hash: Hex;
  reason?: string;
}
```

In `pollReceipt` success branch where `TRANSFER_CONFIRMED_EVENT` emits, include `transfer.id` from DB row. Same for `TRANSFER_FAILED_EVENT` updates.

Handlers in `BotService` can ignore `transferId` until poll listener consumes it.

Run: `pnpm exec jest src/transfer/transfer.service.spec.ts` — update mocks if emit expectations exist.

---

### Task 4: Pure parimutuel allocation (TDD)

**Files:**

- Create: `src/poll/allocate-binary-parimutuel.ts`
- Create: `src/poll/allocate-binary-parimutuel.spec.ts`

Implementation:

```typescript
export interface WinnerStakeAggregate {
  readonly telegramId: bigint;
  readonly totalStakeWinningSide: bigint;
}

export function allocateBinaryParimutuel(parameters: {
  readonly totalStakeWinning: bigint;
  readonly totalStakeLosing: bigint;
  readonly winnerStakeByTelegramId: ReadonlyMap<bigint, bigint>;
}): ReadonlyMap<bigint, bigint> {
  const winningTotal = parameters.totalStakeWinning;
  if (winningTotal === 0n) {
    throw new Error('Parimutuel requires positive winning stake total');
  }
  const grossPool = winningTotal + parameters.totalStakeLosing;
  const results = new Map<bigint, bigint>();
  for (const [telegramId, stakeIncoming] of parameters.winnerStakeByTelegramId.entries()) {
    const payoutAmount = (stakeIncoming * grossPool) / winningTotal;
    if (payoutAmount > 0n) results.set(telegramId, payoutAmount);
  }
  return results;
}

export function parimutuelDustRemainder(parameters: {
  readonly totalStakeWinning: bigint;
  readonly totalStakeLosing: bigint;
  readonly payouts: ReadonlyMap<bigint, bigint>;
}): bigint {
  const grossPool = parameters.totalStakeWinning + parameters.totalStakeLosing;
  let distributed = 0n;
  for (const payout of parameters.payouts.values()) distributed += payout;
  return grossPool - distributed;
}
```

**Tests** (minimal three cases):

```typescript
describe('allocateBinaryParimutuel', () => {
  it('splits losers into winners proportionally when both sides funded', () => {
    const totalWinning = 10n + 20n;
    const totalLosing = 90n + 180n;
    const winnerStakeByTelegramId = new Map<bigint, bigint>([
      [1n, 10n],
      [2n, 20n],
    ]);
    const payouts = allocateBinaryParimutuel({
      totalStakeWinning: totalWinning,
      totalStakeLosing: totalLosing,
      winnerStakeByTelegramId,
    });
    expect(payouts.get(1n)).toBe(100n);
    expect(payouts.get(2n)).toBe(200n);
    expect(parimutuelDustRemainder({ totalStakeWinning: totalWinning, totalStakeLosing: totalLosing, payouts })).toBe(0n);
  });

  it('identity payout when losers total is zero', () => {
    const payouts = allocateBinaryParimutuel({
      totalStakeWinning: 50n,
      totalStakeLosing: 0n,
      winnerStakeByTelegramId: new Map([[9n, 50n]]),
    });
    expect(payouts.get(9n)).toBe(50n);
  });

  it('leaves remainder dust under floor truncation', () => {
    const payouts = allocateBinaryParimutuel({
      totalStakeWinning: 10n + 30n,
      totalStakeLosing: 1n + 10n + 300n + 2700n,
      winnerStakeByTelegramId: new Map([
        [1n, 10n],
        [2n, 30n],
      ]),
    });
    const dust = parimutuelDustRemainder({
      totalStakeWinning: 40n,
      totalStakeLosing: 3011n,
      payouts,
    });
    expect(dust).toBeGreaterThanOrEqual(0n);
  });
});
```

Run: `pnpm exec jest src/poll/allocate-binary-parimutuel.spec.ts`

Commit: `test: add binary parimutuel allocator`

---

### Task 5: `PollService` lifecycle

**Files:**

- Create: `src/poll/poll.service.ts`
- Create: `src/poll/errors.ts` (`PollClosedError`, `PollNotCreatorError`, `PollInvalidStateError`, `PollResolveNoWinnersError`)

Responsibilities:

- **`createPoll({ creatorTelegramId, networkId, title, sideALabel, sideBLabel })`** → `PollState.OPEN`.
- **`getPollById`** + **`summarizePollForDisplay`** aggregates: per-side sum of **`VoteIntent.amountBaseUnits`** only where **`status STAKE_CONFIRMED`** and **`stakeConfirmedAt`** `<=`**`closedAt`** when `CLOSED | RESOLVED` (otherwise only show confirmed stakes counted when still `OPEN`: show provisional sum for UX or hide until close — recommend **summarize totals only after `CLOSED`** for correctness; until then show `"Open — stakes finalize at close"` and optional raw count without committed totals).

**Recommendation for MVP summarize:** Always query **eligible intents** predicate from spec §3.2; while `OPEN` and `closedAt` null — treat rule as **`stakeConfirmedAt <= now`** would be wrong; spec says cutoff `closedAt`. While open, totals are **informative provisional**: sum **`STAKE_CONFIRMED`** intents with **`poll.state OPEN`** disregarding cutoff (creator sees momentum). After close, **`stakeEligible = stakeConfirmedAt <= closedAt`**. Implement two methods if needed internally.

- **`closePoll(pollId, creatorTelegramId)`** transitions `OPEN`→`CLOSED`, sets **`closedAt`**. Invalidate stale **`VoteIntent`** in `DRAFT`/`AWAITING_ESCROW_PAYMENT`→ `BLOCKED_CLOSED` *(or **`CANCELLED` / `SUPERSEDED` — stick to schema enum **`BLOCKED_CLOSED`** from spec)*.

- **`resolvePoll(pollId, creatorTelegramId, winningPollSide)`** only from `CLOSED`. Compute aggregates `W`/`L`; **reject if `W === 0`**. Compute `allocateBinaryParimutuel`; `createMany` **`PollWinnerPayout`** **`UNCLAIMED`** rows (skip zeros). Transition `RESOLVED`.

Use Prisma **`$transaction`** for resolve atomicity.

---

### Task 6: `VoteIntentService` + stake initiation

**Files:**

- Create: `src/poll/vote-intent.service.ts`
- Depends: `PollService`, `TransferService.initiate`, `AppConfigService` (escrow addr), **`AccountService`** (current network equals poll.network)

Flows:

1. **`startDraft(pollId, telegramId, outcome, amountBaseUnits)`**: validate poll **`OPEN`**; TTL `expiresAt = now + env OTP_TTL` (reuse); create **`DRAFT`** intent.
2. **`confirmDraftAndInitiateStake(intentId, telegramId)`**: load **`DRAFT`**, validate not expired / poll still open / same telegram / balance check via `WalletService` like `handleSend`; set transfer recipient **escrow**; call **`transferService.initiate(telegramId, network, escrowAddressHex, amountBaseUnits)`**; update intent **`AWAITING_ESCROW_PAYMENT`**, **`pendingTransferId`**.
3. Optionally **`cancelDraft`**.

Reject if poll network ≠ user selected network (**align spec “poll pinned to creator network”** participants must **`/switch`** to poll network).

---

### Task 7: Listener — confirmed stake finalization

**Files:**

- Create: `src/poll/poll-transfer-confirmed.listener.ts`

```typescript
@Injectable()
export class PollTransferConfirmedListener {
  constructor(private readonly prisma: PrismaService) {}

  @OnEvent(TRANSFER_CONFIRMED_EVENT)
  async handleTransferConfirmed(event: TransferStatusEvent): Promise<void> {
    const transfer = await this.prisma.pendingTransfer.findUnique({
      where: { id: event.transferId },
    });
    if (!transfer || transfer.status !== TransferStatus.CONFIRMED) return;

    const voteIntent = await this.prisma.voteIntent.findUnique({
      where: { pendingTransferId: transfer.id },
    });
    if (!voteIntent) return;

    const poll = await this.prisma.poll.findUnique({
      where: { id: voteIntent.pollId },
    });
    if (!poll) return;

    const escrow = /* read from injected AppConfig */;
    const recipientChecksOut = checksumMatch(transfer.recipient, escrow);
    const networkMatchesPoll = transfer.networkId === poll.networkId;
    const amountMatchesIntent = BigInt(transfer.amount) === BigInt(voteIntent.amountBaseUnits);
    if (!(recipientChecksOut && networkMatchesPoll && amountMatchesIntent)) {
      await this.failIntent(voteIntent.id, transfer.id);
      return;
    }

    await this.prisma.voteIntent.update({
      where: { id: voteIntent.id },
      data: {
        status: VoteIntentStatus.STAKE_CONFIRMED,
        stakeConfirmedAt: transfer.confirmedAt ?? new Date(),
      },
    });
  }
}
```

Use **`getAddress`** for recipient vs escrow.** On mismatch mark intent **`FAILED`** and log loudly.

Emit path: **`TransferService.pollReceipt`** sets **`CONFIRMED`** before emitting event — **`confirmedAt`** may still be stale in schema (existing code sets **`confirmedAt` on SUBMITTED** bug out of poll scope).

---

### Task 8: Escrow payouts + `/claim_poll`

**Files:**

- Create: `src/poll/poll-escrow-payout.service.ts`

Use **`privateKeyToAccount`**, **`createWalletClient`**, **`http(network.rpcUrl)`**, **`walletClient.sendTransaction`** ERC20 **`transfer`** to user SA address from **`WalletService.deriveAddress(telegramId, network)`**:

```typescript
async claimPollPayout(parameters: {
  telegramId: bigint;
  pollId: string;
}): Promise<{ txHash: Hex } | { status: 'nothing_to_claim' }> {
  const payoutRow = await this.prisma.pollWinnerPayout.findUnique({
    where: { pollId_telegramId: { pollId: parameters.pollId, telegramId: parameters.telegramId } },
  });
  if (!payoutRow || payoutRow.status !== PollPayoutStatus.UNCLAIMED || BigInt(payoutRow.amountOwedBaseUnits) === 0n) {
    return { status: 'nothing_to_claim' };
  }

  await this.prisma.pollWinnerPayout.update({
    where: { id: payoutRow.id },
    data: { status: PollPayoutStatus.PROCESSING },
  });

  try {
    const poll = await this.prisma.poll.findUniqueOrThrow({ where: { id: parameters.pollId } });
    const network = await this.networkRegistryService.findByIdOrThrow(poll.networkId);
    const recipientSa = await this.walletService.deriveAddress(parameters.telegramId, network);

    const hash = await this.sendUsdcFromEscrowEoa({
      network,
      recipient: recipientSa,
      amount: BigInt(payoutRow.amountOwedBaseUnits),
    });

    await this.prisma.pollWinnerPayout.update({
      where: { id: payoutRow.id },
      data: {
        status: PollPayoutStatus.PAID,
        paidAt: new Date(),
        outboundTxHash: hash,
      },
    });
    return { txHash: hash };
  } catch (error) {
    await this.prisma.pollWinnerPayout.update({
      where: { id: payoutRow.id },
      data: { status: PollPayoutStatus.UNCLAIMED },
    });
    throw error;
  }
}
```

Implement **`sendUsdcFromEscrowEoa`** mirroring **`WalletService`** network clients but signer = escrow PK. No bundler strictly required if EOA pays gas (**testnet**/small scope).

Concurrent claims: **`PROCESSING`** lock + transactional update as above.

---

### Task 9: Bot handlers (parsable MVP command shapes)

**Files:**

- Create: `src/bot/handlers/poll.handlers.ts`

Suggested syntax (explicit, avoids multi-step conversational state for now while still honoring **“two-step VoteIntent confirm”**:

- **`/create_poll <title> | <sideA> | <sideB>`** — split `' | '` into three parts trimmed; truncate lengths (e.g. 200/80/80).
- **`/poll <pollUuid>`**.
- **`/vote_poll <pollUuid> <A|B> <amount>`** — builds **`VoteIntent`**; reply “Reply **CONFIRM_POLL** within 120s” or **second message** heuristic: hears **`/^CONFIRM_POLL$/`** uses latest **`DRAFT`** intent for telegram (query `findFirst` order `createdAt desc` where telegram + `DRAFT`). Cleaner: **`inline confirmation`** same message after preview is OK MVP if you shorten “VoteIntent”: show summary + **`Reply YES to confirm`** using **`/^YES$/`** pattern registered **before** OTP regex conflicts — **⚠ OTP handler conflict:** six-digit OTP; **`YES`** is safe.

**VoteIntent confirmation:** user replies **`YES`** after `/vote_poll` bot printed preview → handler calls **`confirmDraftAndInitiateStake`**.

Track **expiresAt**: if **`YES`** after expiry→ clear message.

- **`/close_poll <pollUuid>`** creator only.
- **`/resolve_poll <pollUuid> <A|B>`** creator only.
- **`/claim_poll <pollUuid>`** any eligible winner.

Register **`bot.hears(/^YES$/i, ...)`** after middleware with guard: latest draft intent belongs to telegram.

Update **`handleHelp`** with usage strings.

---

### Task 10: Wire `PollModule`, `BotModule`, guards

**Files:**

- Create: `src/poll/poll.module.ts`
- Modify: `src/bot/bot.module.ts`
- Modify: `src/app.module.ts`
- Modify: `src/bot/bot.service.ts`

`PollModule` imports **`DatabaseModule`**, **`ConfigModule`**, **`WalletModule`**, **`TransferModule`**, **`NetworkModule`**, **`AccountModule`**, **`EventEmitterModule.forRoot`** is already global App — **`PollTransferConfirmedListener`** as provider exports none if listener auto registers.

Avoid circular imports: **`VoteIntentService`** must not pull `Bot`.

---

### Task 11: Tests and verification

**Files:**

- Create: extend `src/bot/handlers/handlers.spec.ts` or **`poll.handlers.spec.ts`** following `handlers.spec.ts` mocking style.
- Optionally `src/poll/poll.service.spec.ts` with Prisma test double / integration.

Run full suite:

```bash
pnpm exec eslint .
pnpm exec jest --runInBand
pnpm run build
```

---

## Self-review (plan vs spec)

| Spec § | Covered by |
|--------|-------------|
| B1 Creator house | **resolve/close creator checks** in `PollService` |
| B2 OTP stake → escrow | **`VoteIntentService` + TransferService.initiate** |
| B3 fixed escrow env | **`POLL_USDC_ESCROW_ADDRESS`** |
| Binary + parimutuel | Task 4 allocator + **`resolvePoll`** |
| Close before resolve | state machine in **`PollService`** |
| VoteIntent UX | Tasks 9 + **YES** handshake |
| Claim no OTP MVP | **`PollEscrowPayoutService`** |
| Dust remainder in escrow | **Allocator + log `parimutuelDustRemainder`** on resolve |

**Gap addressed:** **`AWAITING_OTP` collision across `/send` and vote** inherits existing **`TransferService.initiate`** cancel-all-awaiting semantics — document in **`docs/runbook.md`** one bullet.

---

**Plan saved to:** `plans/2026-05-04-telegram-binary-polls-implementation-plan.md`

**Execution**

1. **Subagent-driven (recommended)** — fresh subagent per task, quick review checkpoints.  
2. **Inline** — execute sequentially in one session (`executing-plans` checkpoints).

Tell me whether you prefer **1** or **2** to start implementation.
