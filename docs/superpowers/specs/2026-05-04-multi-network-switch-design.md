# Multi-Network Switching Design

Date: 2026-05-04
Status: Approved (brainstorming)
Owner: ZeroKey Wallet

## Goal

Per-user switchable EVM networks, with network metadata (chain id, RPC URL,
USDC/token address) sourced from the database instead of environment variables.
A user can run `/switch <network_slug>` in Telegram to change their selected
network, and `/balance`, `/send`, `/address` then operate on that network.

## Non-Goals

- Runtime mutation of network rows from the bot (any `/admin add-network` flow).
- Multi-token support per network (still only USDC per network for MVP).
- Cross-chain transfers, bridging, or unified balance views.
- Gas sponsorship logic changes; smart accounts still need native gas on each
  network.

## Background

Today `WalletService` is bound to `bscTestnet` from `viem/chains` and reads
`BSC_TESTNET_RPC_URL` plus `USDC_ADDRESS_BSC_TESTNET` from `.env` via
`AppConfigService`. `User.address` is one column, derived once via
`SafeSmartAccount.toSafeSmartAccount` with `saltNonce: telegramId`. Adding a
second chain therefore requires both data model changes and a refactor of how
viem clients and Pimlico bundler URLs are constructed.

## Key Decisions

- **Per-user selection.** Each Telegram user has an independent `selected_network`.
- **AA address differs per chain.** Safe AA counterfactual addresses depend on
  chain context; we will derive and store one AA address per `(user, network)`
  pair instead of assuming a single global address.
- **Database is the source of truth for network config.** RPC URL, chain id,
  USDC address, and `enabled` live in a `Network` table; the bot only reads.
- **Migration + seed are the only write path.** New networks are added by a PR
  that updates `prisma/seed.ts` and ships a new migration if needed; no runtime
  admin command.
- **Pending transfers are pinned to the network they started on.** Switching
  networks mid-flow does not redirect a `/send` that is already awaiting OTP.
- **`/networks` command is in scope.** Lightweight UX so users do not have to
  guess slugs.

## Architecture

### Data model (Prisma)

Add `Network`:

```prisma
model Network {
  id                  String                 @id @default(uuid())
  slug                String                 @unique
  chainId             Int                    @map("chain_id")
  displayName         String                 @map("display_name")
  rpcUrl              String                 @map("rpc_url")
  usdcAddress         String                 @map("usdc_address")
  enabled             Boolean                @default(true)
  createdAt           DateTime               @default(now()) @map("created_at")
  users               User[]
  userAddresses       UserNetworkAddress[]
  pendingTransfers    PendingTransfer[]

  @@map("networks")
}
```

Update `User`:

```prisma
model User {
  telegramId         BigInt               @id @map("telegram_id")
  selectedNetworkId  String               @map("selected_network_id")
  selectedNetwork    Network              @relation(fields: [selectedNetworkId], references: [id])
  createdAt          DateTime             @default(now()) @map("created_at")
  transfers          PendingTransfer[]
  addresses          UserNetworkAddress[]

  @@map("users")
}
```

Add `UserNetworkAddress`:

```prisma
model UserNetworkAddress {
  telegramId BigInt   @map("telegram_id")
  networkId  String   @map("network_id")
  address    String
  createdAt  DateTime @default(now()) @map("created_at")

  user    User    @relation(fields: [telegramId], references: [telegramId])
  network Network @relation(fields: [networkId], references: [id])

  @@id([telegramId, networkId])
  @@unique([networkId, address])
  @@map("user_network_addresses")
}
```

Update `PendingTransfer` to pin the network:

```prisma
model PendingTransfer {
  id          String         @id @default(uuid())
  telegramId  BigInt         @map("telegram_id")
  networkId   String         @map("network_id")
  recipient   String
  amount      String
  otpHash     String         @map("otp_hash")
  retryCount  Int            @default(0) @map("retry_count")
  status      TransferStatus
  txHash      String?        @map("tx_hash")
  createdAt   DateTime       @default(now()) @map("created_at")
  confirmedAt DateTime?      @map("confirmed_at")

  user    User    @relation(fields: [telegramId], references: [telegramId])
  network Network @relation(fields: [networkId], references: [id])

  @@index([telegramId, status])
  @@map("pending_transfers")
}
```

Existing `User.address` column is dropped after backfill (single migration
batch).

### Network registry

New `src/network/network-registry.service.ts`:

- `findBySlug(slug: string): Promise<Network | null>` (case-insensitive).
- `findByIdOrThrow(id: string): Promise<Network>`.
- `listEnabled(): Promise<Network[]>` (used by `/networks`).
- `getDefaultNetwork(): Promise<Network>` reads the seeded default
  (a row with the `default` slug, validated at startup).
- `toViemChain(network)`: returns a `viem` chain object via `defineChain`,
  using `chain_id`, `displayName`, and `rpc_url`. (No reliance on
  `viem/chains` constants for non-BSC networks.)
- In-process cache keyed by `network.id` for the resolved viem chain object
  and any derived strings (Pimlico URL is built per call from `chain_id`).

### Wallet service refactor

`WalletService` becomes network-parameterised:

- `deriveAddress(telegramId: bigint, network: Network): Promise<Hex>`
- `getUsdcBalance(address: Hex, network: Network): Promise<bigint>`
- `sendUsdc(telegramId: bigint, network: Network, recipient: Hex, amount: bigint): Promise<Hex>`
- `waitForUsdcTransfer(network: Network, hash: Hex): Promise<void>`

Internally:

- Public client and Pimlico bundler URL are constructed lazily on first use
  per `chain_id` from `network.rpc_url`, `network.chain_id`, and
  `PIMLICO_API_KEY`, then cached in a
  `Map<chainId, { publicClient, bundlerTransport }>` for the process lifetime.
- USDC decimals are cached per `network.id` (read on first use, default 6 on
  failure as today).
- Safe AA derivation passes the per-network `publicClient` to
  `SafeSmartAccount.toSafeSmartAccount`, keeping `saltNonce: telegramId`.
- `WalletNetworkError` semantics unchanged.

### Account service

`AccountService` gains a `getOrCreateForNetwork(telegramId, network)` that
returns `UserNetworkAddress`, deriving via `WalletService.deriveAddress` and
handling `P2002` races identically to today’s code.

`getOrCreate(telegramId)` is replaced by a higher-level
`getCurrentAccount(telegramId)` that loads the user (with
`selectedNetwork`) and resolves the address for that network.

### Bot commands

- `/start`: ensures `User` exists with `selected_network_id = default network`,
  ensures `UserNetworkAddress` for the default network, replies with the
  network display name and the address.
- `/switch <slug>`: validates the slug, ensures `enabled=true`, updates
  `User.selected_network_id`, ensures a `UserNetworkAddress` row exists for
  that network, replies with the new network name and address.
  - Bad slug or disabled: replies with the list from `/networks`.
- `/networks`: lists enabled networks (slug + display name + chain id) and
  marks the user’s currently selected network.
- `/address`: shows the address for the user’s current network and labels the
  network in the message and QR caption.
- `/balance`: reads USDC balance via the user’s current network.
- `/send <amount> <0x>`: snapshots the user’s current `selected_network_id`
  into `PendingTransfer.network_id` at creation time. OTP confirmation and
  broadcast use that pinned network even if the user later runs `/switch`.
- `/help`: updated text mentions `/switch` and `/networks`.

### Configuration

- `env.schema.ts` and `AppConfigService` lose `BSC_TESTNET_RPC_URL` and
  `USDC_ADDRESS_BSC_TESTNET`. Remaining required envs: `DATABASE_URL`,
  `BOT_TOKEN`, `SERVER_EOA_PRIVATE_KEY`, `PIMLICO_API_KEY`, `OTP_TTL_SECONDS`,
  `OTP_MAX_RETRIES`, `LOG_LEVEL`, `NODE_ENV`.
- `.env.example` is reduced to the secrets list above; network values move to
  `prisma/seed.ts`.
- `docs/runbook.md` updated: integration tests pick a seeded network by slug
  (`TEST_NETWORK_SLUG`), so funded credentials are no longer split across
  several `TEST_*` env vars per chain.

## Migration / Seed

Single migration ships:

1. Create `networks`, insert seeded BSC testnet row inline.
2. Add `users.selected_network_id` (nullable), backfill = inserted BSC
   testnet id, then set NOT NULL with FK.
3. Create `user_network_addresses`, backfill one row per existing user
   `(telegram_id, bsc_testnet_id, users.address)`.
4. Add `pending_transfers.network_id` (nullable), backfill all existing rows
   to BSC testnet id, set NOT NULL with FK.
5. Drop `users.address`.

`prisma/seed.ts` becomes idempotent (`upsert` by `slug`) and is the only
declarative source of network metadata. The seed script is invoked from
deploy tooling (added to `docs/runbook.md`).

Initial seeded row, derived from current `.env.example`:

- `slug = "bsc_testnet"` (also the default)
- `chain_id = 97`
- `display_name = "BSC Testnet"`
- `rpc_url = "https://data-seed-prebsc-1-s1.binance.org:8545"`
- `usdc_address = "0xaD88B079712CC38a8D33E072CB6434E652556441"`
- `enabled = true`

A "default network" is identified by a hard-coded slug constant
(`DEFAULT_NETWORK_SLUG = "bsc_testnet"`) loaded by the registry at startup;
the registry throws on boot if the row is missing or disabled.

## Error Handling

- Unknown / disabled slug on `/switch`: reply `"Unknown network. Try /networks."`
- RPC failure: existing `WalletNetworkError("Network busy")` path, prefixed
  with the network display name in the user-facing message.
- Race on `UserNetworkAddress.create`: catch `P2002`, refetch by composite
  key (mirrors `AccountService.getOrCreate`).
- Pending transfer broadcast on a network whose `enabled` flipped to false:
  proceed (network row still exists by id); user-facing copy unchanged.
  Disabling is operational, not a kill-switch.

## Testing

Unit:

- `NetworkRegistryService`: lookup by slug (case-insensitive), throws on
  unknown/disabled, `toViemChain` returns a chain object with the expected
  `id` and `rpcUrls.default.http`.
- `WalletService`: `deriveAddress`, `getUsdcBalance`, `sendUsdc` accept a
  `Network` argument; with two mocked networks the same `telegramId` produces
  two distinct addresses; balance reads use the network’s `usdc_address`;
  Pimlico URL is built from `chain_id`.
- Bot handlers:
  - `/switch` happy path updates `selected_network_id` and ensures
    `UserNetworkAddress`.
  - `/switch` bad slug returns the help text from `/networks`.
  - `/networks` lists enabled rows and marks current.
  - `/send` creates `PendingTransfer` with the user’s current
    `selected_network_id`; switching afterwards does not change the row.
  - `/balance` and `/address` use the user’s current network.

Integration:

- `wallet.integration.spec.ts` parameterised on `Network` loaded from a test
  seed; runs against any seeded network when funded credentials are set.

Migration:

- Migration test on a snapshot of the existing schema with sample users and
  pending transfers; assert post-migration that every user has a
  `UserNetworkAddress` row with the original address and that
  `PendingTransfer.network_id` matches the seeded BSC testnet id.

## Risks

- **Pinning transfers.** Pinning to network on `/send` is essential because
  OTP confirmation can race with `/switch`; without it a user could send on
  the wrong chain.
- **viem chain object.** Using `defineChain` with seeded RPC means we lose
  some of the curated metadata `viem/chains` provides (e.g. block explorers).
  Acceptable for MVP; revisit if explorer links are added.
- **Client cache lifetime.** RPC URL changes require a process restart since
  clients are cached by `chain_id`. Documented in the runbook.
- **Two sources of truth.** Removing the env vars in the same PR as the
  migration prevents drift between `.env` and `Network` rows.
- **`/address` semantics change.** After this PR `/address` shows the address
  for the user’s current network, which can differ from the address from
  before this change for any user we add new networks for. Mitigated by
  always labelling the network in the reply.

## Open Items

None. Ready for implementation planning.
