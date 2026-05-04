# Multi-Network Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move chain RPC and USDC token addresses into the database, let each Telegram user switch networks with `/switch <slug>`, and operate `/balance`, `/send`, `/address` against the user's selected network.

**Architecture:** Add `Network`, `UserNetworkAddress` Prisma models; add `User.selected_network_id` and `PendingTransfer.network_id`. Introduce a read-only `NetworkRegistryService` that resolves networks by slug/id and builds viem chain objects via `defineChain`. Refactor `WalletService` to accept a `Network` per call, caching public client + Pimlico transport per `chainId`. Add `/networks` and `/switch` handlers. Pin `PendingTransfer.network_id` at `/send` time so OTP confirmation stays on the originating chain.

**Tech Stack:** NestJS 11, Prisma 7 (`@prisma/adapter-pg`), viem 2 (`defineChain`, `createPublicClient`), permissionless 0.3 (`SafeSmartAccount`, Pimlico bundler), grammy 1.42, Joi env schema, Jest 30 with `ts-jest`.

---

## File Structure Overview

**New files:**
- `src/network/network-registry.service.ts` — DB-backed lookup, viem chain factory, in-process cache.
- `src/network/network-registry.service.spec.ts`
- `src/network/network.module.ts`
- `src/bot/handlers/switch.handler.ts`
- `src/bot/handlers/networks.handler.ts`
- `prisma/seed.ts`
- `prisma/migrations/<timestamp>_multi_network/migration.sql` (generated, then edited)

**Modified files:**
- `prisma/schema.prisma`
- `prisma.config.ts` (wire seed)
- `src/wallet/wallet.service.ts`
- `src/wallet/wallet.module.ts`
- `src/wallet/wallet.service.spec.ts`
- `src/wallet/wallet.integration.spec.ts`
- `src/account/account.service.ts`
- `src/account/account.service.spec.ts`
- `src/account/account.module.ts`
- `src/transfer/transfer.service.ts`
- `src/transfer/transfer.module.ts`
- `src/bot/bot.service.ts`
- `src/bot/handlers/start.handler.ts`
- `src/bot/handlers/address.handler.ts`
- `src/bot/handlers/balance.handler.ts`
- `src/bot/handlers/send.handler.ts`
- `src/bot/handlers/help.handler.ts`
- `src/bot/handlers/handlers.spec.ts`
- `src/config/env.schema.ts`
- `src/config/app-config.service.ts`
- `.env.example`
- `docs/runbook.md`

**Deleted env vars (after Task 10):** `BSC_TESTNET_RPC_URL`, `USDC_ADDRESS_BSC_TESTNET`.

---

## Task 1: Prisma Schema and Migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_multi_network/migration.sql`

- [ ] **Step 1: Replace `prisma/schema.prisma` with the multi-network schema**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
}

model Network {
  id               String                @id @default(uuid())
  slug             String                @unique
  chainId          Int                   @map("chain_id")
  displayName      String                @map("display_name")
  rpcUrl           String                @map("rpc_url")
  usdcAddress      String                @map("usdc_address")
  enabled          Boolean               @default(true)
  createdAt        DateTime              @default(now()) @map("created_at")

  users            User[]
  userAddresses    UserNetworkAddress[]
  pendingTransfers PendingTransfer[]

  @@map("networks")
}

model User {
  telegramId        BigInt               @id @map("telegram_id")
  selectedNetworkId String               @map("selected_network_id")
  selectedNetwork   Network              @relation(fields: [selectedNetworkId], references: [id])
  createdAt         DateTime             @default(now()) @map("created_at")

  transfers         PendingTransfer[]
  addresses         UserNetworkAddress[]

  @@map("users")
}

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

- [ ] **Step 2: Generate the migration without applying it**

Run: `pnpm prisma migrate dev --create-only --name multi_network`
Expected: Prisma writes `prisma/migrations/<timestamp>_multi_network/migration.sql` containing CREATE TABLE / ALTER TABLE statements.

- [ ] **Step 3: Replace the generated migration SQL with a backfill-aware version**

Open `prisma/migrations/<timestamp>_multi_network/migration.sql` and replace its body with the SQL below (keep the timestamped folder name Prisma generated):

```sql
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
    '0xd73d3E44a6184179cd9c09cb2e2647981b716568',
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
```

- [ ] **Step 4: Apply the migration locally**

Run: `pnpm prisma migrate dev`
Expected: Migration applies cleanly; `pnpm prisma generate` runs automatically; `pgsql` shows new tables and columns.

- [ ] **Step 5: Verify the backfill against the previous data shape**

If your local database had users or pending transfers before the migration, run the following query (via `pnpm prisma studio` or `psql`):

```sql
SELECT
  (SELECT COUNT(*) FROM "users") AS user_count,
  (SELECT COUNT(*) FROM "user_network_addresses") AS address_count,
  (SELECT COUNT(*) FROM "users" WHERE "selected_network_id" IS NULL) AS users_missing_network,
  (SELECT COUNT(*) FROM "pending_transfers" WHERE "network_id" IS NULL) AS transfers_missing_network;
```

Expected: `user_count = address_count`, `users_missing_network = 0`, and `transfers_missing_network = 0`. If your DB was empty, all four values are 0 — also acceptable.

- [ ] **Step 6: Smoke-check the generated client compiles**

Run: `pnpm tsc -p tsconfig.build.json --noEmit`
Expected: Compile errors only in files we will refactor in later tasks. Note them; they are expected (e.g., `User.address` no longer exists).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add networks, user_network_addresses, pin pending_transfers.network_id"
```

---

## Task 2: Prisma Seed Script

**Files:**
- Create: `prisma/seed.ts`
- Modify: `prisma.config.ts`

- [ ] **Step 1: Write `prisma/seed.ts` with idempotent network upsert**

```ts
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { config as loadEnv } from 'dotenv';

loadEnv();

interface NetworkSeed {
  slug: string;
  chainId: number;
  displayName: string;
  rpcUrl: string;
  usdcAddress: string;
  enabled: boolean;
}

const NETWORKS: ReadonlyArray<NetworkSeed> = [
  {
    slug: 'bsc_testnet',
    chainId: 97,
    displayName: 'BSC Testnet',
    rpcUrl: 'https://data-seed-prebsc-1-s1.binance.org:8545',
    usdcAddress: '0xd73d3E44a6184179cd9c09cb2e2647981b716568',
    enabled: true,
  },
];

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set; cannot run seed.');
  }

  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prismaClient = new PrismaClient({ adapter });

  try {
    for (const network of NETWORKS) {
      await prismaClient.network.upsert({
        where: { slug: network.slug },
        update: {
          chainId: network.chainId,
          displayName: network.displayName,
          rpcUrl: network.rpcUrl,
          usdcAddress: network.usdcAddress,
          enabled: network.enabled,
        },
        create: network,
      });
    }
  } finally {
    await prismaClient.$disconnect();
  }
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Wire the seed into `prisma.config.ts`**

Replace `prisma.config.ts` with:

```ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

type Env = {
  DATABASE_URL: string;
};

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env<Env>('DATABASE_URL'),
  },
});
```

- [ ] **Step 3: Run the seed and confirm idempotency**

Run: `pnpm prisma db seed`
Expected: Exits 0; running it again produces no row changes (`networks` table still has exactly one row with `slug = 'bsc_testnet'`).

- [ ] **Step 4: Commit**

```bash
git add prisma/seed.ts prisma.config.ts
git commit -m "feat(db): seed networks table idempotently"
```

---

## Task 3: NetworkRegistryService

**Files:**
- Create: `src/network/network-registry.service.ts`
- Create: `src/network/network-registry.service.spec.ts`
- Create: `src/network/network.module.ts`

- [ ] **Step 1: Write the failing unit test**

Create `src/network/network-registry.service.spec.ts`:

```ts
import { NetworkRegistryService } from './network-registry.service';

describe('NetworkRegistryService', () => {
  const baseNetwork = {
    id: 'net-1',
    slug: 'bsc_testnet',
    chainId: 97,
    displayName: 'BSC Testnet',
    rpcUrl: 'https://example.test/rpc',
    usdcAddress: '0xd73d3E44a6184179cd9c09cb2e2647981b716568',
    enabled: true,
    createdAt: new Date(),
  };

  it('returns enabled network by slug case-insensitively', async () => {
    const prismaService = createPrismaWithNetworks([baseNetwork]);
    const service = new NetworkRegistryService(prismaService);

    await expect(service.findBySlug('BSC_TESTNET')).resolves.toEqual(baseNetwork);
  });

  it('returns null when network is unknown', async () => {
    const prismaService = createPrismaWithNetworks([]);
    const service = new NetworkRegistryService(prismaService);

    await expect(service.findBySlug('unknown')).resolves.toBeNull();
  });

  it('returns null when network is disabled', async () => {
    const prismaService = createPrismaWithNetworks([{ ...baseNetwork, enabled: false }]);
    const service = new NetworkRegistryService(prismaService);

    await expect(service.findBySlug('bsc_testnet')).resolves.toBeNull();
  });

  it('throws on findByIdOrThrow for missing id', async () => {
    const prismaService = createPrismaWithNetworks([]);
    const service = new NetworkRegistryService(prismaService);

    await expect(service.findByIdOrThrow('missing')).rejects.toThrow(/Network missing not found/);
  });

  it('lists only enabled networks ordered by displayName', async () => {
    const prismaService = createPrismaWithNetworks([
      baseNetwork,
      { ...baseNetwork, id: 'net-2', slug: 'eth_sepolia', displayName: 'Ethereum Sepolia' },
      { ...baseNetwork, id: 'net-3', slug: 'old', displayName: 'Old', enabled: false },
    ]);
    const service = new NetworkRegistryService(prismaService);

    const enabled = await service.listEnabled();
    expect(enabled.map((network) => network.slug)).toEqual(['bsc_testnet', 'eth_sepolia']);
  });

  it('builds a viem chain via toViemChain with the given rpc and id', () => {
    const prismaService = createPrismaWithNetworks([baseNetwork]);
    const service = new NetworkRegistryService(prismaService);

    const chain = service.toViemChain(baseNetwork);
    expect(chain.id).toBe(97);
    expect(chain.rpcUrls.default.http).toEqual(['https://example.test/rpc']);
    expect(chain.name).toBe('BSC Testnet');
  });
});

function createPrismaWithNetworks(rows: Array<Record<string, unknown>>) {
  return {
    network: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const slug = typeof where.slug === 'string' ? where.slug.toLowerCase() : undefined;
        const id = typeof where.id === 'string' ? where.id : undefined;
        return (
          rows.find((row) => {
            if (slug !== undefined) {
              return (row.slug as string).toLowerCase() === slug && row.enabled !== false;
            }
            if (id !== undefined) {
              return row.id === id;
            }
            return false;
          }) ?? null
        );
      }),
      findMany: jest.fn(async () => rows.filter((row) => row.enabled !== false)),
    },
  } as never;
}
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm test -- src/network/network-registry.service.spec.ts`
Expected: FAIL with `Cannot find module './network-registry.service'`.

- [ ] **Step 3: Implement `NetworkRegistryService`**

Create `src/network/network-registry.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Network } from '@prisma/client';
import { defineChain, type Chain } from 'viem';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class NetworkRegistryService {
  private readonly chainCache = new Map<number, Chain>();

  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
  ) {}

  async findBySlug(slug: string): Promise<Network | null> {
    const normalizedSlug = slug.trim().toLowerCase();
    return this.prismaService.network.findFirst({
      where: { slug: normalizedSlug, enabled: true },
    });
  }

  async findByIdOrThrow(networkId: string): Promise<Network> {
    const network = await this.prismaService.network.findFirst({
      where: { id: networkId },
    });
    if (!network) {
      throw new Error(`Network ${networkId} not found`);
    }
    return network;
  }

  async listEnabled(): Promise<Network[]> {
    const enabled = await this.prismaService.network.findMany({
      where: { enabled: true },
      orderBy: { displayName: 'asc' },
    });
    return enabled;
  }

  toViemChain(network: Network): Chain {
    const cached = this.chainCache.get(network.chainId);
    if (cached) {
      return cached;
    }

    const chain = defineChain({
      id: network.chainId,
      name: network.displayName,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: {
        default: { http: [network.rpcUrl] },
      },
    });
    this.chainCache.set(network.chainId, chain);
    return chain;
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm test -- src/network/network-registry.service.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Add the Nest module wrapping the service**

Create `src/network/network.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { NetworkRegistryService } from './network-registry.service';

@Module({
  imports: [DatabaseModule],
  providers: [NetworkRegistryService],
  exports: [NetworkRegistryService],
})
export class NetworkModule {}
```

- [ ] **Step 6: Register the module in `AppModule`**

Edit `src/app.module.ts`. Add the import and put `NetworkModule` in `imports`:

```ts
import { NetworkModule } from './network/network.module';
```

```ts
imports: [
  AccountModule,
  BotModule,
  ConfigModule,
  DatabaseModule,
  NetworkModule,
  OtpModule,
  TransferModule,
  WalletModule,
  EventEmitterModule.forRoot(),
  // ...
],
```

- [ ] **Step 7: Commit**

```bash
git add src/network src/app.module.ts
git commit -m "feat(network): add NetworkRegistryService with DB-backed lookup and chain factory"
```

---

## Task 4: WalletService Refactor (network-aware)

**Files:**
- Modify: `src/wallet/wallet.service.ts`
- Modify: `src/wallet/wallet.service.spec.ts`
- Modify: `src/wallet/wallet.module.ts`

- [ ] **Step 1: Update the unit test to drive the new signature**

Replace `src/wallet/wallet.service.spec.ts` with:

```ts
import type { Network } from '@prisma/client';
import { WalletService } from './wallet.service';

describe('WalletService', () => {
  const network: Network = {
    id: 'net-1',
    slug: 'bsc_testnet',
    chainId: 97,
    displayName: 'BSC Testnet',
    rpcUrl: 'https://example.test/rpc',
    usdcAddress: '0xd73d3E44a6184179cd9c09cb2e2647981b716568',
    enabled: true,
    createdAt: new Date(),
  };

  it('formatUsdc preserves trailing whole numbers without exponential notation', () => {
    const service = new WalletService(
      { pimlicoApiKey: 'unused', serverEoaPrivateKey: '0x' + '11'.repeat(32) } as never,
      { toViemChain: () => ({ id: network.chainId }) } as never,
    );

    expect(service.formatUsdc(1_000_000n)).toBe('1');
    expect(service.formatUsdc(1_500_000n)).toBe('1.5');
    expect(service.formatUsdc(0n)).toBe('0');
    expect(service.formatUsdc(1_234_567_891_000_000n)).toBe('1,234,567,891');
  });

  it('parseUsdc converts decimal strings to base units', () => {
    const service = new WalletService(
      { pimlicoApiKey: 'unused', serverEoaPrivateKey: '0x' + '11'.repeat(32) } as never,
      { toViemChain: () => ({ id: network.chainId }) } as never,
    );

    expect(service.parseUsdc('1')).toBe(1_000_000n);
    expect(service.parseUsdc('0.5')).toBe(500_000n);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm test -- src/wallet/wallet.service.spec.ts`
Expected: FAIL because `WalletService` constructor still takes only `AppConfigService` and methods are not yet network-parameterised.

- [ ] **Step 3: Refactor `WalletService` to accept a `Network` per call**

Replace `src/wallet/wallet.service.ts` with:

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Network } from '@prisma/client';
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  parseUnits,
  type Chain,
  type Hex,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { entryPoint07Address, type SmartAccount } from 'viem/account-abstraction';
import { createSmartAccountClient } from 'permissionless';
import { SafeSmartAccount } from 'permissionless/accounts/safe';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { AppConfigService } from '../config/app-config.service';
import { WalletNetworkError } from '../common/exceptions';
import { NetworkRegistryService } from '../network/network-registry.service';

interface NetworkClients {
  publicClient: PublicClient;
  pimlicoRpcUrl: string;
  chain: Chain;
}

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);
  private readonly serverAccount: PrivateKeyAccount;
  private readonly networkClientCache = new Map<number, NetworkClients>();
  private readonly usdcDecimalsCache = new Map<string, number>();

  constructor(
    @Inject(AppConfigService)
    private readonly appConfigService: AppConfigService,
    @Inject(NetworkRegistryService)
    private readonly networkRegistryService: NetworkRegistryService,
  ) {
    this.serverAccount = privateKeyToAccount(this.appConfigService.serverEoaPrivateKey);
  }

  async deriveAddress(telegramId: bigint, network: Network): Promise<Hex> {
    const account = await this.createSmartAccount(telegramId, network);
    return getAddress(account.address);
  }

  async getUsdcBalance(address: Hex, network: Network): Promise<bigint> {
    const clients = this.getOrCreateNetworkClients(network);
    return clients.publicClient.readContract({
      address: getAddress(network.usdcAddress),
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
    });
  }

  formatUsdc(amountBaseUnits: bigint): string {
    const formattedUnits = formatUnits(amountBaseUnits, 6);
    return WalletService.formatBalanceForDisplay(formattedUnits);
  }

  parseUsdc(amount: string): bigint {
    return parseUnits(amount, 6);
  }

  async sendUsdc(
    telegramId: bigint,
    network: Network,
    recipientAddress: Hex,
    amountBaseUnits: bigint,
  ): Promise<Hex> {
    return this.withSingleRetry(async () => {
      const smartAccountClient = await this.createSmartAccountClient(telegramId, network);
      return smartAccountClient.sendTransaction({
        to: getAddress(network.usdcAddress),
        value: 0n,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'transfer',
          args: [recipientAddress, amountBaseUnits],
        }),
      });
    });
  }

  async waitForUsdcTransfer(network: Network, hash: Hex): Promise<void> {
    const clients = this.getOrCreateNetworkClients(network);
    await clients.publicClient.waitForTransactionReceipt({ hash });
  }

  async getUsdcDecimals(network: Network): Promise<number> {
    const cached = this.usdcDecimalsCache.get(network.id);
    if (cached !== undefined) {
      return cached;
    }
    try {
      const clients = this.getOrCreateNetworkClients(network);
      const decimals = await clients.publicClient.readContract({
        address: getAddress(network.usdcAddress),
        abi: erc20Abi,
        functionName: 'decimals',
      });
      const numericDecimals = Number(decimals);
      this.usdcDecimalsCache.set(network.id, numericDecimals);
      return numericDecimals;
    } catch (error) {
      this.logger.warn(
        { err: error, networkSlug: network.slug },
        'Could not read token decimals from chain; using 6',
      );
      this.usdcDecimalsCache.set(network.id, 6);
      return 6;
    }
  }

  private getOrCreateNetworkClients(network: Network): NetworkClients {
    const cached = this.networkClientCache.get(network.chainId);
    if (cached) {
      return cached;
    }
    const chain = this.networkRegistryService.toViemChain(network);
    const publicClient = createPublicClient({
      chain,
      transport: http(network.rpcUrl),
    });
    const pimlicoRpcUrl = `https://api.pimlico.io/v2/${network.chainId}/rpc?apikey=${this.appConfigService.pimlicoApiKey}`;
    const clients: NetworkClients = { publicClient, pimlicoRpcUrl, chain };
    this.networkClientCache.set(network.chainId, clients);
    return clients;
  }

  private async createSmartAccount(telegramId: bigint, network: Network): Promise<SmartAccount> {
    const clients = this.getOrCreateNetworkClients(network);
    return SafeSmartAccount.toSafeSmartAccount({
      client: clients.publicClient,
      owners: [this.serverAccount],
      threshold: 1n,
      version: '1.4.1',
      entryPoint: {
        address: entryPoint07Address,
        version: '0.7',
      },
      saltNonce: telegramId,
    });
  }

  private async createSmartAccountClient(telegramId: bigint, network: Network) {
    const clients = this.getOrCreateNetworkClients(network);
    const account = await this.createSmartAccount(telegramId, network);
    const pimlicoClient = createPimlicoClient({
      chain: clients.chain,
      transport: http(clients.pimlicoRpcUrl),
      entryPoint: {
        address: entryPoint07Address,
        version: '0.7',
      },
    });

    return createSmartAccountClient({
      account,
      chain: clients.chain,
      client: clients.publicClient,
      bundlerTransport: http(clients.pimlicoRpcUrl),
      userOperation: {
        estimateFeesPerGas: async () => {
          return (await pimlicoClient.getUserOperationGasPrice()).fast;
        },
      },
    });
  }

  private static formatBalanceForDisplay(formattedUnits: string): string {
    const trimmedInput = formattedUnits.trim();
    const isNegative = trimmedInput.startsWith('-');
    const unsigned = isNegative ? trimmedInput.slice(1) : trimmedInput;
    const [wholeRaw, fractionRaw = ''] = unsigned.split('.');
    const wholeNormalized = wholeRaw.replace(/^0+(?=\d)/, '') || '0';
    const groupedWhole = BigInt(wholeNormalized).toLocaleString('en-US');
    const trimmedFraction = fractionRaw.replace(/0+$/, '');
    const combined =
      trimmedFraction.length > 0 ? `${groupedWhole}.${trimmedFraction}` : groupedWhole;
    return isNegative ? `-${combined}` : combined;
  }

  private async withSingleRetry<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (firstError) {
      this.logger.warn({ err: firstError }, 'Wallet operation failed; retrying once');
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      try {
        return await operation();
      } catch (secondError) {
        this.logger.error({ err: secondError }, 'Wallet operation failed after retry');
        throw new WalletNetworkError('Network busy');
      }
    }
  }
}
```

- [ ] **Step 4: Update `WalletModule` to import `NetworkModule`**

Replace `src/wallet/wallet.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { NetworkModule } from '../network/network.module';
import { WalletService } from './wallet.service';

@Module({
  imports: [ConfigModule, NetworkModule],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
```

- [ ] **Step 5: Run tests to verify the wallet unit test passes**

Run: `pnpm test -- src/wallet/wallet.service.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/wallet/wallet.service.ts src/wallet/wallet.module.ts src/wallet/wallet.service.spec.ts
git commit -m "feat(wallet): make WalletService network-parameterised with chain client cache"
```

---

## Task 5: AccountService Refactor (per-network address)

**Files:**
- Modify: `src/account/account.service.ts`
- Modify: `src/account/account.service.spec.ts`
- Modify: `src/account/account.module.ts`

- [ ] **Step 1: Update the unit test to drive the new API**

Replace `src/account/account.service.spec.ts` with:

```ts
import { Prisma } from '@prisma/client';
import { AccountService } from './account.service';

const network = {
  id: 'net-1',
  slug: 'bsc_testnet',
  chainId: 97,
  displayName: 'BSC Testnet',
  rpcUrl: 'https://example.test/rpc',
  usdcAddress: '0xd73d3E44a6184179cd9c09cb2e2647981b716568',
  enabled: true,
  createdAt: new Date(),
};

const telegramId = 123456789n;
const address = '0x00000000000000000000000000000000075bcd15';

describe('AccountService', () => {
  it('returns existing address for the network without deriving', async () => {
    const prismaService = createPrisma({
      userNetworkAddress: { findUnique: jest.fn().mockResolvedValue({ telegramId, networkId: network.id, address }) },
    });
    const walletService = { deriveAddress: jest.fn() };
    const service = new AccountService(prismaService, walletService as never, {} as never);

    await expect(service.getOrCreateForNetwork(telegramId, network)).resolves.toEqual({
      address,
      networkId: network.id,
      isNew: false,
    });
    expect(walletService.deriveAddress).not.toHaveBeenCalled();
  });

  it('derives and creates an address for an unseen (user, network) pair', async () => {
    const create = jest.fn().mockResolvedValue({ telegramId, networkId: network.id, address });
    const prismaService = createPrisma({
      userNetworkAddress: {
        findUnique: jest.fn().mockResolvedValue(null),
        create,
      },
      user: {
        upsert: jest.fn().mockResolvedValue({ telegramId, selectedNetworkId: network.id }),
      },
    });
    const walletService = { deriveAddress: jest.fn().mockResolvedValue(address) };
    const service = new AccountService(prismaService, walletService as never, {} as never);

    await expect(service.getOrCreateForNetwork(telegramId, network)).resolves.toEqual({
      address,
      networkId: network.id,
      isNew: true,
    });
    expect(create).toHaveBeenCalledWith({
      data: { telegramId, networkId: network.id, address },
    });
  });

  it('recovers from unique races by re-fetching the (user, network) row', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ telegramId, networkId: network.id, address });
    const create = jest
      .fn()
      .mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '1' }),
      );
    const prismaService = createPrisma({
      userNetworkAddress: { findUnique, create },
      user: {
        upsert: jest.fn().mockResolvedValue({ telegramId, selectedNetworkId: network.id }),
      },
    });
    const walletService = { deriveAddress: jest.fn().mockResolvedValue(address) };
    const service = new AccountService(prismaService, walletService as never, {} as never);

    await expect(service.getOrCreateForNetwork(telegramId, network)).resolves.toEqual({
      address,
      networkId: network.id,
      isNew: false,
    });
  });

  it('getCurrentAccount loads user with selected network and resolves address', async () => {
    const prismaService = createPrisma({
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          telegramId,
          selectedNetworkId: network.id,
          selectedNetwork: network,
        }),
      },
      userNetworkAddress: {
        findUnique: jest.fn().mockResolvedValue({ telegramId, networkId: network.id, address }),
      },
    });
    const walletService = { deriveAddress: jest.fn() };
    const service = new AccountService(prismaService, walletService as never, {} as never);

    const result = await service.getCurrentAccount(telegramId);
    expect(result).toEqual({ address, network, isNew: false });
  });
});

function createPrisma(overrides: Record<string, unknown>) {
  return {
    user: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      ...(overrides.user as object | undefined),
    },
    userNetworkAddress: {
      findUnique: jest.fn(),
      create: jest.fn(),
      ...(overrides.userNetworkAddress as object | undefined),
    },
  } as never;
}
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm test -- src/account/account.service.spec.ts`
Expected: FAIL (`getOrCreateForNetwork` and `getCurrentAccount` are not implemented).

- [ ] **Step 3: Replace `AccountService` with the network-aware implementation**

Replace `src/account/account.service.ts` with:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type Network } from '@prisma/client';
import type { Hex } from 'viem';
import { PrismaService } from '../database/prisma.service';
import { NetworkRegistryService } from '../network/network-registry.service';
import { WalletService } from '../wallet/wallet.service';

export interface AccountForNetwork {
  address: Hex;
  networkId: string;
  isNew: boolean;
}

export interface CurrentAccount {
  address: Hex;
  network: Network;
  isNew: boolean;
}

@Injectable()
export class AccountService {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(WalletService)
    private readonly walletService: WalletService,
    @Inject(NetworkRegistryService)
    private readonly networkRegistryService: NetworkRegistryService,
  ) {}

  async getOrCreateForNetwork(
    telegramId: bigint,
    network: Network,
  ): Promise<AccountForNetwork> {
    const existing = await this.prismaService.userNetworkAddress.findUnique({
      where: { telegramId_networkId: { telegramId, networkId: network.id } },
    });
    if (existing) {
      return { address: existing.address as Hex, networkId: network.id, isNew: false };
    }

    await this.prismaService.user.upsert({
      where: { telegramId },
      update: {},
      create: { telegramId, selectedNetworkId: network.id },
    });

    const derivedAddress = await this.walletService.deriveAddress(telegramId, network);

    try {
      await this.prismaService.userNetworkAddress.create({
        data: { telegramId, networkId: network.id, address: derivedAddress },
      });
      return { address: derivedAddress, networkId: network.id, isNew: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await this.prismaService.userNetworkAddress.findUnique({
          where: { telegramId_networkId: { telegramId, networkId: network.id } },
        });
        if (raced) {
          return { address: raced.address as Hex, networkId: network.id, isNew: false };
        }
      }
      throw error;
    }
  }

  async getCurrentAccount(telegramId: bigint): Promise<CurrentAccount> {
    const user = await this.prismaService.user.findUniqueOrThrow({
      where: { telegramId },
      include: { selectedNetwork: true },
    });
    const account = await this.getOrCreateForNetwork(telegramId, user.selectedNetwork);
    return { address: account.address, network: user.selectedNetwork, isNew: account.isNew };
  }

  async ensureUserOnDefaultNetwork(telegramId: bigint): Promise<CurrentAccount> {
    const existing = await this.prismaService.user.findUnique({
      where: { telegramId },
      include: { selectedNetwork: true },
    });
    if (existing) {
      const account = await this.getOrCreateForNetwork(telegramId, existing.selectedNetwork);
      return { address: account.address, network: existing.selectedNetwork, isNew: account.isNew };
    }

    const defaultNetwork = await this.resolveDefaultNetwork();
    await this.prismaService.user.create({
      data: { telegramId, selectedNetworkId: defaultNetwork.id },
    });
    const account = await this.getOrCreateForNetwork(telegramId, defaultNetwork);
    return { address: account.address, network: defaultNetwork, isNew: true };
  }

  async switchNetwork(telegramId: bigint, network: Network): Promise<CurrentAccount> {
    await this.prismaService.user.upsert({
      where: { telegramId },
      update: { selectedNetworkId: network.id },
      create: { telegramId, selectedNetworkId: network.id },
    });
    const account = await this.getOrCreateForNetwork(telegramId, network);
    return { address: account.address, network, isNew: account.isNew };
  }

  private async resolveDefaultNetwork(): Promise<Network> {
    const defaultNetwork = await this.networkRegistryService.findBySlug(
      AccountService.DEFAULT_NETWORK_SLUG,
    );
    if (!defaultNetwork) {
      throw new Error(`Default network ${AccountService.DEFAULT_NETWORK_SLUG} is not seeded`);
    }
    return defaultNetwork;
  }

  static readonly DEFAULT_NETWORK_SLUG = 'bsc_testnet';
}
```

- [ ] **Step 4: Update `AccountModule` to depend on `NetworkModule`**

Replace `src/account/account.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { NetworkModule } from '../network/network.module';
import { WalletModule } from '../wallet/wallet.module';
import { AccountService } from './account.service';

@Module({
  imports: [DatabaseModule, NetworkModule, WalletModule],
  providers: [AccountService],
  exports: [AccountService],
})
export class AccountModule {}
```

- [ ] **Step 5: Run the account tests**

Run: `pnpm test -- src/account/account.service.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/account
git commit -m "feat(account): per-network address resolution and ensureUserOnDefaultNetwork"
```

---

## Task 6: Pin `network_id` on PendingTransfer

**Files:**
- Modify: `src/transfer/transfer.service.ts`
- Modify: `src/transfer/transfer.module.ts`

- [ ] **Step 1: Update `TransferService.initiate` to take a network and persist it**

In `src/transfer/transfer.service.ts`, change `initiate` and `confirm` to thread `Network` through. Replace the relevant portions as follows.

At the top, add:

```ts
import type { Network } from '@prisma/client';
import { NetworkRegistryService } from '../network/network-registry.service';
```

Update the constructor to inject `NetworkRegistryService`:

```ts
constructor(
  @Inject(PrismaService)
  private readonly prismaService: PrismaService,
  @Inject(OtpService)
  private readonly otpService: OtpService,
  @Inject(WalletService)
  private readonly walletService: WalletService,
  @Inject(NetworkRegistryService)
  private readonly networkRegistryService: NetworkRegistryService,
  @Inject(EventEmitter2)
  private readonly eventEmitter: EventEmitter2,
) {}
```

Replace `initiate` with:

```ts
async initiate(
  telegramId: bigint,
  network: Network,
  recipientAddress: Hex,
  amountBaseUnits: bigint,
): Promise<InitiatedTransfer> {
  await this.prismaService.pendingTransfer.updateMany({
    where: { telegramId, status: TransferStatus.AWAITING_OTP },
    data: { status: TransferStatus.CANCELLED },
  });

  const code = this.otpService.generateCode();
  const pendingTransfer = await this.prismaService.pendingTransfer.create({
    data: {
      telegramId,
      networkId: network.id,
      recipient: recipientAddress,
      amount: amountBaseUnits.toString(),
      otpHash: this.otpService.hashCode(code),
      status: TransferStatus.AWAITING_OTP,
    },
  });

  return { transferId: pendingTransfer.id, code };
}
```

Replace the `walletService.sendUsdc` call inside `confirm` with the pinned network:

```ts
const pinnedNetwork = await this.networkRegistryService.findByIdOrThrow(pendingTransfer.networkId);
const txHash = await this.walletService.sendUsdc(
  telegramId,
  pinnedNetwork,
  pendingTransfer.recipient as Hex,
  BigInt(pendingTransfer.amount),
);
```

Replace `waitForReceiptWithTimeout` with:

```ts
private async waitForReceiptWithTimeout(network: Network, hash: Hex): Promise<void> {
  let timeoutId: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      this.walletService.waitForUsdcTransfer(network, hash),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new ReceiptTimeoutError()), 60_000);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
```

Replace `pollReceipt` with:

```ts
async pollReceipt(transferId: string, hash: Hex): Promise<void> {
  const transferToPoll = await this.prismaService.pendingTransfer.findFirst({
    where: { id: transferId },
  });
  if (!transferToPoll) {
    throw new NoPendingTransferError();
  }

  const pinnedNetwork = await this.networkRegistryService.findByIdOrThrow(
    transferToPoll.networkId,
  );

  try {
    await this.waitForReceiptWithTimeout(pinnedNetwork, hash);
  } catch (error) {
    const status =
      error instanceof ReceiptTimeoutError ? TransferStatus.TIMEOUT : TransferStatus.FAILED;
    const transfer = await this.prismaService.pendingTransfer.update({
      where: { id: transferId },
      data: { status },
    });
    this.eventEmitter.emit(TRANSFER_FAILED_EVENT, {
      chatId: transfer.telegramId,
      hash,
      reason: error instanceof Error ? error.message : 'Receipt polling failed',
    });
    return;
  }

  const transfer = await this.prismaService.pendingTransfer.update({
    where: { id: transferId },
    data: { status: TransferStatus.CONFIRMED },
  });

  this.eventEmitter.emit(TRANSFER_CONFIRMED_EVENT, {
    chatId: transfer.telegramId,
    hash,
  });
}
```

- [ ] **Step 2: Update `TransferModule` to import `NetworkModule`**

Replace `src/transfer/transfer.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { NetworkModule } from '../network/network.module';
import { OtpModule } from '../otp/otp.module';
import { WalletModule } from '../wallet/wallet.module';
import { TransferService } from './transfer.service';

@Module({
  imports: [DatabaseModule, NetworkModule, OtpModule, WalletModule],
  providers: [TransferService],
  exports: [TransferService],
})
export class TransferModule {}
```

- [ ] **Step 3: Run the test suite to verify nothing in transfer broke**

Run: `pnpm test -- src/transfer`
Expected: PASS, or no `transfer` tests to run; if any compile or test failures appear, address them by aligning mocks with the new constructor signature (add `networkRegistryService: { findByIdOrThrow: jest.fn() }` mocks where needed).

- [ ] **Step 4: Commit**

```bash
git add src/transfer
git commit -m "feat(transfer): pin network_id on PendingTransfer through OTP and broadcast"
```

---

## Task 7: `/networks` Handler

**Files:**
- Create: `src/bot/handlers/networks.handler.ts`
- Modify: `src/bot/handlers/handlers.spec.ts`
- Modify: `src/bot/bot.service.ts`

- [ ] **Step 1: Add a failing handler test for `/networks`**

Append to `src/bot/handlers/handlers.spec.ts`:

```ts
import { handleNetworks } from './networks.handler';

describe('/networks handler', () => {
  it('lists enabled networks with the user current selection marked', async () => {
    const ctx = createContext('/networks');
    const accountService = {
      getCurrentAccount: jest.fn().mockResolvedValue({
        address: '0x00000000000000000000000000000000075bcd15',
        network: { id: 'net-1', slug: 'bsc_testnet', displayName: 'BSC Testnet', chainId: 97 },
        isNew: false,
      }),
    };
    const networkRegistryService = {
      listEnabled: jest.fn().mockResolvedValue([
        { id: 'net-1', slug: 'bsc_testnet', displayName: 'BSC Testnet', chainId: 97 },
        { id: 'net-2', slug: 'eth_sepolia', displayName: 'Ethereum Sepolia', chainId: 11155111 },
      ]),
    };

    await handleNetworks(ctx, accountService as never, networkRegistryService as never);

    const reply = ctx.reply.mock.calls[0][0] as string;
    expect(reply).toContain('• bsc_testnet — BSC Testnet (97) [current]');
    expect(reply).toContain('• eth_sepolia — Ethereum Sepolia (11155111)');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm test -- src/bot/handlers/handlers.spec.ts -t "networks handler"`
Expected: FAIL with `Cannot find module './networks.handler'`.

- [ ] **Step 3: Implement the `/networks` handler**

Create `src/bot/handlers/networks.handler.ts`:

```ts
import type { Context } from 'grammy';
import type { AccountService } from '../../account/account.service';
import type { NetworkRegistryService } from '../../network/network-registry.service';
import { getTelegramId } from './context';

export async function handleNetworks(
  ctx: Context,
  accountService: Pick<AccountService, 'getCurrentAccount'>,
  networkRegistryService: Pick<NetworkRegistryService, 'listEnabled'>,
): Promise<void> {
  const telegramId = getTelegramId(ctx);
  if (!telegramId) {
    await ctx.reply('Unable to identify your Telegram account.');
    return;
  }

  const [networks, current] = await Promise.all([
    networkRegistryService.listEnabled(),
    accountService.getCurrentAccount(telegramId).catch(() => null),
  ]);

  const lines = networks.map((network) => {
    const marker = current && current.network.id === network.id ? ' [current]' : '';
    return `• ${network.slug} — ${network.displayName} (${network.chainId})${marker}`;
  });

  await ctx.reply(['Available networks:', ...lines, '', 'Use /switch <slug> to change.'].join('\n'));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- src/bot/handlers/handlers.spec.ts -t "networks handler"`
Expected: PASS.

- [ ] **Step 5: Register the command in `BotService`**

In `src/bot/bot.service.ts`:

Add the import at the top:

```ts
import { handleNetworks } from './handlers/networks.handler';
import { NetworkRegistryService } from '../network/network-registry.service';
```

Add the dependency to the constructor signature:

```ts
@Inject(NetworkRegistryService)
private readonly networkRegistryService: NetworkRegistryService,
```

Inside `registerHandlers()`, add:

```ts
this.bot.command('networks', (ctx) =>
  handleNetworks(ctx, this.accountService, this.networkRegistryService),
);
```

- [ ] **Step 6: Update `BotModule` to import `NetworkModule`**

In `src/bot/bot.module.ts`, add `NetworkModule` to the `imports` array (alongside `AccountModule`, `WalletModule`, `TransferModule`).

- [ ] **Step 7: Commit**

```bash
git add src/bot/handlers/networks.handler.ts src/bot/bot.service.ts src/bot/bot.module.ts src/bot/handlers/handlers.spec.ts
git commit -m "feat(bot): /networks lists enabled networks and marks current"
```

---

## Task 8: `/switch` Handler

**Files:**
- Create: `src/bot/handlers/switch.handler.ts`
- Modify: `src/bot/handlers/handlers.spec.ts`
- Modify: `src/bot/bot.service.ts`

- [ ] **Step 1: Add failing tests for `/switch`**

Append to `src/bot/handlers/handlers.spec.ts`:

```ts
import { handleSwitch } from './switch.handler';

describe('/switch handler', () => {
  const network = {
    id: 'net-1',
    slug: 'bsc_testnet',
    displayName: 'BSC Testnet',
    chainId: 97,
  };

  it('replies with the new network and address on success', async () => {
    const ctx = createContext('/switch BSC_Testnet');
    const accountService = {
      switchNetwork: jest.fn().mockResolvedValue({
        address: '0x00000000000000000000000000000000075bcd15',
        network,
        isNew: false,
      }),
    };
    const networkRegistryService = {
      findBySlug: jest.fn().mockResolvedValue(network),
      listEnabled: jest.fn().mockResolvedValue([network]),
    };

    await handleSwitch(ctx, accountService as never, networkRegistryService as never);

    expect(networkRegistryService.findBySlug).toHaveBeenCalledWith('BSC_Testnet');
    expect(accountService.switchNetwork).toHaveBeenCalledWith(123456789n, network);
    const reply = ctx.reply.mock.calls[0][0] as string;
    expect(reply).toContain('Switched to BSC Testnet (97)');
    expect(reply).toContain('0x00000000000000000000000000000000075bcd15');
  });

  it('rejects unknown slug with usage hint', async () => {
    const ctx = createContext('/switch nope');
    const accountService = { switchNetwork: jest.fn() };
    const networkRegistryService = {
      findBySlug: jest.fn().mockResolvedValue(null),
      listEnabled: jest.fn().mockResolvedValue([
        { id: 'net-1', slug: 'bsc_testnet', displayName: 'BSC Testnet', chainId: 97 },
      ]),
    };

    await handleSwitch(ctx, accountService as never, networkRegistryService as never);

    expect(accountService.switchNetwork).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Unknown network. Try /networks.'),
    );
  });

  it('replies with usage when slug missing', async () => {
    const ctx = createContext('/switch');
    const accountService = { switchNetwork: jest.fn() };
    const networkRegistryService = {
      findBySlug: jest.fn(),
      listEnabled: jest.fn().mockResolvedValue([]),
    };

    await handleSwitch(ctx, accountService as never, networkRegistryService as never);

    expect(ctx.reply).toHaveBeenCalledWith('Usage: /switch <network_slug>');
  });
});
```

- [ ] **Step 2: Run the new tests, expect failure**

Run: `pnpm test -- src/bot/handlers/handlers.spec.ts -t "switch handler"`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `/switch`**

Create `src/bot/handlers/switch.handler.ts`:

```ts
import type { Context } from 'grammy';
import type { AccountService } from '../../account/account.service';
import type { NetworkRegistryService } from '../../network/network-registry.service';
import { getMessageText, getTelegramId } from './context';

export async function handleSwitch(
  ctx: Context,
  accountService: Pick<AccountService, 'switchNetwork'>,
  networkRegistryService: Pick<NetworkRegistryService, 'findBySlug' | 'listEnabled'>,
): Promise<void> {
  const telegramId = getTelegramId(ctx);
  if (!telegramId) {
    await ctx.reply('Unable to identify your Telegram account.');
    return;
  }

  const parts = getMessageText(ctx).trim().split(/\s+/);
  if (parts.length !== 2) {
    await ctx.reply('Usage: /switch <network_slug>');
    return;
  }
  const slug = parts[1];

  const network = await networkRegistryService.findBySlug(slug);
  if (!network) {
    const enabled = await networkRegistryService.listEnabled();
    const slugs = enabled.map((entry) => entry.slug).join(', ');
    await ctx.reply(`Unknown network. Try /networks.\nAvailable: ${slugs}`);
    return;
  }

  const result = await accountService.switchNetwork(telegramId, network);
  await ctx.reply(
    [
      `Switched to ${network.displayName} (${network.chainId}).`,
      `Address: ${result.address}`,
    ].join('\n'),
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- src/bot/handlers/handlers.spec.ts -t "switch handler"`
Expected: PASS (3 tests).

- [ ] **Step 5: Register `/switch` in `BotService`**

In `src/bot/bot.service.ts`, add:

```ts
import { handleSwitch } from './handlers/switch.handler';
```

Inside `registerHandlers()`:

```ts
this.bot.command('switch', (ctx) =>
  handleSwitch(ctx, this.accountService, this.networkRegistryService),
);
```

- [ ] **Step 6: Commit**

```bash
git add src/bot/handlers/switch.handler.ts src/bot/handlers/handlers.spec.ts src/bot/bot.service.ts
git commit -m "feat(bot): /switch updates selected network and ensures per-network address"
```

---

## Task 9: Update Existing Handlers and Help Text

**Files:**
- Modify: `src/bot/handlers/start.handler.ts`
- Modify: `src/bot/handlers/address.handler.ts`
- Modify: `src/bot/handlers/balance.handler.ts`
- Modify: `src/bot/handlers/send.handler.ts`
- Modify: `src/bot/handlers/help.handler.ts`
- Modify: `src/bot/handlers/handlers.spec.ts`

- [ ] **Step 1: Update existing handler tests to use the new account API**

In `src/bot/handlers/handlers.spec.ts`, replace `createAccountService()` with:

```ts
function createAccountService() {
  const network = {
    id: 'net-1',
    slug: 'bsc_testnet',
    chainId: 97,
    displayName: 'BSC Testnet',
    rpcUrl: 'https://example.test/rpc',
    usdcAddress: '0xd73d3E44a6184179cd9c09cb2e2647981b716568',
    enabled: true,
    createdAt: new Date(),
  };
  return {
    getCurrentAccount: jest.fn().mockResolvedValue({
      address: '0x00000000000000000000000000000000075bcd15',
      network,
      isNew: false,
    }),
    ensureUserOnDefaultNetwork: jest.fn().mockResolvedValue({
      address: '0x00000000000000000000000000000000075bcd15',
      network,
      isNew: false,
    }),
    switchNetwork: jest.fn(),
  };
}
```

Update the existing `handleSend` tests to call with the new `walletService` shape (balance and parse keep their signature; only `getUsdcBalance` now takes `(address, network)` — adjust the mock to ignore the second arg):

```ts
function createWalletService(options: { balance?: bigint } = {}) {
  return {
    parseUsdc: jest.fn((amount: string) => BigInt(Number(amount) * 1_000_000)),
    formatUsdc: jest.fn((amountBaseUnits: bigint) =>
      (Number(amountBaseUnits) / 1_000_000).toString(),
    ),
    getUsdcBalance: jest.fn().mockResolvedValue(options.balance ?? 2_000_000n),
  };
}
```

The `handleSend` test calls also need to thread `transferService.initiate` mocks through with the new 4-arg signature:

```ts
function createTransferService() {
  return {
    initiate: jest.fn().mockResolvedValue({
      transferId: 'transfer-1',
      code: '142857',
    }),
  };
}
```

(No call-site changes are needed in the existing tests because they only assert on `ctx.reply`; just make sure the mocked function accepts any args.)

- [ ] **Step 2: Update `handleStart` to use `ensureUserOnDefaultNetwork`**

Replace `src/bot/handlers/start.handler.ts` with:

```ts
import type { Context } from 'grammy';
import type { AccountService } from '../../account/account.service';
import { getTelegramId } from './context';

export async function handleStart(
  ctx: Context,
  accountService: Pick<AccountService, 'ensureUserOnDefaultNetwork'>,
): Promise<void> {
  const telegramId = getTelegramId(ctx);
  if (!telegramId) {
    await ctx.reply('Unable to identify your Telegram account.');
    return;
  }

  const account = await accountService.ensureUserOnDefaultNetwork(telegramId);
  await ctx.reply(
    [
      'Welcome to ZeroKey Wallet MVP-A.',
      'This bot is custodial and testnet-only.',
      `Network: ${account.network.displayName} (${account.network.chainId})`,
      `Your USDC address: ${account.address}`,
      'Use /balance to check funds, /send <amount> <0x-address> to send USDC,',
      'or /switch <slug> to change networks (see /networks).',
    ].join('\n'),
  );
}
```

- [ ] **Step 3: Update `handleAddress` to use `getCurrentAccount`**

Replace `src/bot/handlers/address.handler.ts` with:

```ts
import { InputFile, type Context } from 'grammy';
import QRCode from 'qrcode';
import type { AccountService } from '../../account/account.service';
import { getTelegramId } from './context';

export async function handleAddress(
  ctx: Context,
  accountService: Pick<AccountService, 'getCurrentAccount'>,
): Promise<void> {
  const telegramId = getTelegramId(ctx);
  if (!telegramId) {
    await ctx.reply('Unable to identify your Telegram account.');
    return;
  }

  const account = await accountService.getCurrentAccount(telegramId);
  const qrPng = await QRCode.toBuffer(account.address);
  await ctx.replyWithPhoto(new InputFile(qrPng, 'zerokey-address.png'), {
    caption: `${account.network.displayName} (${account.network.chainId})\n${account.address}`,
  });
}
```

- [ ] **Step 4: Update `handleBalance` to thread the network through**

Replace `src/bot/handlers/balance.handler.ts` with:

```ts
import type { Context } from 'grammy';
import type { AccountService } from '../../account/account.service';
import type { WalletService } from '../../wallet/wallet.service';
import { getTelegramId } from './context';

export async function handleBalance(
  ctx: Context,
  accountService: Pick<AccountService, 'getCurrentAccount'>,
  walletService: Pick<WalletService, 'getUsdcBalance' | 'formatUsdc'>,
): Promise<void> {
  const telegramId = getTelegramId(ctx);
  if (!telegramId) {
    await ctx.reply('Unable to identify your Telegram account.');
    return;
  }

  const account = await accountService.getCurrentAccount(telegramId);
  const balance = await walletService.getUsdcBalance(account.address, account.network);
  await ctx.reply(
    `USDC balance on ${account.network.displayName}: ${walletService.formatUsdc(balance)}`,
  );
}
```

- [ ] **Step 5: Update `handleSend` to thread the user's network**

Replace `src/bot/handlers/send.handler.ts` with:

```ts
import type { Context } from 'grammy';
import { getAddress, isAddress, zeroAddress, type Hex } from 'viem';
import type { AccountService } from '../../account/account.service';
import type { TransferService } from '../../transfer/transfer.service';
import type { WalletService } from '../../wallet/wallet.service';
import { getMessageText, getTelegramId } from './context';

function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function handleSend(
  ctx: Context,
  accountService: Pick<AccountService, 'getCurrentAccount'>,
  walletService: Pick<WalletService, 'getUsdcBalance' | 'parseUsdc' | 'formatUsdc'>,
  transferService: Pick<TransferService, 'initiate'>,
): Promise<void> {
  const telegramId = getTelegramId(ctx);
  if (!telegramId) {
    await ctx.reply('Unable to identify your Telegram account.');
    return;
  }

  const sendCommandParts = getMessageText(ctx).trim().split(/\s+/);
  if (sendCommandParts.length !== 3) {
    await ctx.reply('Usage: /send <amount> <0x-address>');
    return;
  }
  const [, amountText, recipientText] = sendCommandParts;

  if (!isAddress(recipientText)) {
    await ctx.reply('Invalid Ethereum address.');
    return;
  }

  const account = await accountService.getCurrentAccount(telegramId);
  const recipientAddress = getAddress(recipientText);
  if (recipientAddress === zeroAddress || recipientAddress === getAddress(account.address)) {
    await ctx.reply('Recipient address is not allowed.');
    return;
  }

  let amountBaseUnits: bigint;
  try {
    amountBaseUnits = walletService.parseUsdc(amountText);
  } catch {
    await ctx.reply('Invalid USDC amount.');
    return;
  }

  if (amountBaseUnits <= 0n) {
    await ctx.reply('Amount must be greater than zero.');
    return;
  }

  const balance = await walletService.getUsdcBalance(account.address, account.network);
  if (balance < amountBaseUnits) {
    await ctx.reply('Insufficient USDC balance.');
    return;
  }

  const transfer = await transferService.initiate(
    telegramId,
    account.network,
    recipientAddress as Hex,
    amountBaseUnits,
  );
  const amountFormatted = escapeTelegramHtml(walletService.formatUsdc(amountBaseUnits));
  const recipientEscaped = escapeTelegramHtml(recipientAddress);

  await ctx.reply(
    [
      `Confirm send of ${amountFormatted} USDC on ${account.network.displayName}.`,
      `Recipient: ${recipientEscaped}`,
      `OTP: <tg-spoiler>${escapeTelegramHtml(transfer.code)}</tg-spoiler>`,
      'Reply with the 6-digit OTP within 5 minutes.',
    ].join('\n'),
    { parse_mode: 'HTML' },
  );
}
```

- [ ] **Step 6: Update `handleHelp` to mention new commands**

Replace `src/bot/handlers/help.handler.ts` with:

```ts
import type { Context } from 'grammy';

export async function handleHelp(ctx: Context): Promise<void> {
  await ctx.reply(
    [
      'ZeroKey Wallet commands:',
      '/start - create or view your wallet on the default network',
      '/address - show your address and QR for the current network',
      '/balance - show USDC balance on your current network',
      '/send <amount> <0x-address> - send USDC after OTP confirmation',
      '/networks - list available networks',
      '/switch <slug> - change your active network',
      '/help - show this help',
      '',
      'MVP-A is custodial and testnet-only.',
    ].join('\n'),
  );
}
```

- [ ] **Step 7: Update the bot wiring in `BotService`**

In `src/bot/bot.service.ts`, the existing handler registrations now need the new dependencies. Replace `registerHandlers()` body with:

```ts
private registerHandlers(): void {
  this.bot.command('start', (ctx) => handleStart(ctx, this.accountService));
  this.bot.command('address', (ctx) => handleAddress(ctx, this.accountService));
  this.bot.command('balance', (ctx) =>
    handleBalance(ctx, this.accountService, this.walletService),
  );
  this.bot.command('send', (ctx) =>
    handleSend(ctx, this.accountService, this.walletService, this.transferService),
  );
  this.bot.command('switch', (ctx) =>
    handleSwitch(ctx, this.accountService, this.networkRegistryService),
  );
  this.bot.command('networks', (ctx) =>
    handleNetworks(ctx, this.accountService, this.networkRegistryService),
  );
  this.bot.command('help', handleHelp);
  this.bot.hears(/^\d{6}$/, (ctx: Context) =>
    handleOtp(ctx, this.accountService, this.transferService),
  );
  this.bot.catch(async (error) => {
    this.logger.error({ err: error.error }, 'Telegram bot handler failed');
    await error.ctx.reply('Something went wrong. Try again or /help.');
  });
}
```

Update `handleOtp` to use the network-aware account API. Replace `src/bot/handlers/otp.handler.ts` with:

```ts
import type { Context } from 'grammy';
import {
  NoPendingTransferError,
  OtpExpiredError,
  OtpInvalidError,
  WalletNetworkError,
} from '../../common/exceptions';
import type { AccountService } from '../../account/account.service';
import type { TransferService } from '../../transfer/transfer.service';
import { getMessageText, getTelegramId } from './context';

export async function handleOtp(
  ctx: Context,
  accountService: Pick<AccountService, 'getCurrentAccount'>,
  transferService: Pick<TransferService, 'confirm'>,
): Promise<void> {
  const telegramId = getTelegramId(ctx);
  if (!telegramId) {
    await ctx.reply('Unable to identify your Telegram account.');
    return;
  }

  await accountService.getCurrentAccount(telegramId);

  try {
    const submittedTransfer = await transferService.confirm(
      telegramId,
      getMessageText(ctx).trim(),
      {
        afterOtpAccepted: async () => {
          await ctx.reply(
            'Submitting your transfer to the network. This may take a minute — hang tight.',
          );
        },
      },
    );
    await ctx.reply(`Transfer submitted: ${submittedTransfer.hash}`);
  } catch (error) {
    if (error instanceof OtpExpiredError) {
      await ctx.reply('OTP expired. Start a new /send.');
      return;
    }

    if (error instanceof OtpInvalidError) {
      await ctx.reply(`Invalid OTP. ${error.retriesLeft} retries left.`);
      return;
    }

    if (error instanceof NoPendingTransferError) {
      await ctx.reply('No pending transfer. Start with /send.');
      return;
    }

    if (error instanceof WalletNetworkError) {
      await ctx.reply('Network busy. Try again later.');
      return;
    }

    throw error;
  }
}
```

- [ ] **Step 8: Run the full unit test suite**

Run: `pnpm test`
Expected: PASS for all suites. If `handlers.spec.ts` `getUsdcBalance` mock now receives a second `network` argument, the existing `expect`s on `ctx.reply` still hold; no change should be needed to the assertions.

- [ ] **Step 9: Commit**

```bash
git add src/bot
git commit -m "feat(bot): thread per-user network through /start, /address, /balance, /send, /help"
```

---

## Task 10: Remove BSC Env Vars and Update Docs

**Files:**
- Modify: `src/config/env.schema.ts`
- Modify: `src/config/app-config.service.ts`
- Modify: `.env.example`
- Modify: `docs/runbook.md`

- [ ] **Step 1: Drop the BSC-specific keys from the env schema**

Replace `src/config/env.schema.ts` with:

```ts
import Joi from 'joi';

export const envSchema = Joi.object({
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql'] })
    .required(),
  BOT_TOKEN: Joi.string().min(10).required(),
  SERVER_EOA_PRIVATE_KEY: Joi.string()
    .pattern(/^0x[a-fA-F0-9]{64}$/)
    .required(),
  PIMLICO_API_KEY: Joi.string().min(1).required(),
  OTP_TTL_SECONDS: Joi.number().integer().positive().default(300),
  OTP_MAX_RETRIES: Joi.number().integer().min(1).default(3),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace')
    .default('info'),
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
});
```

- [ ] **Step 2: Drop the BSC-specific getters from `AppConfigService`**

Open `src/config/app-config.service.ts` and remove the `bscTestnetRpcUrl` and `usdcAddress` getters. The remaining getters stay unchanged.

- [ ] **Step 3: Update `.env.example`**

Replace `.env.example` with:

```dotenv
DATABASE_URL="postgresql://zerokey:zerokey_local@localhost:5432/zerokey_wallet"
BOT_TOKEN="1234567:ABC..."
SERVER_EOA_PRIVATE_KEY="0x..."
PIMLICO_API_KEY="replace-with-pimlico-api-key"
OTP_TTL_SECONDS=300
OTP_MAX_RETRIES=3
LOG_LEVEL="info"
NODE_ENV="development"
```

- [ ] **Step 4: Update the runbook**

Edit `docs/runbook.md`. Replace the `Wallet Integration Tests` section with:

```markdown
## Wallet Integration Tests

`src/wallet/wallet.integration.spec.ts` is skipped unless funded testnet credentials
are provided. The test loads a network row from the database by slug, so the
seeded network is the source of truth for chain id, RPC URL, and USDC address:

```bash
TEST_SERVER_EOA_PRIVATE_KEY="0x..."
TEST_PIMLICO_API_KEY="..."
TEST_NETWORK_SLUG="bsc_testnet"
pnpm test:integration
```

Add a row to the `networks` table for any chain you want to test against; the
integration test will use whichever row matches `TEST_NETWORK_SLUG`.
```

Add a "Network Configuration" section above "Refill Smart Account Gas":

```markdown
## Network Configuration

Network metadata (chain id, RPC URL, USDC address, enabled flag) lives in the
`networks` table. Edit `prisma/seed.ts` and run `pnpm prisma db seed` to
add or update networks. The bot caches viem clients per `chain_id` for the
process lifetime; restart the bot after changing an `rpc_url`.
```

- [ ] **Step 5: Run the full type-check and tests**

Run: `pnpm tsc -p tsconfig.build.json --noEmit && pnpm test`
Expected: PASS. Any compile errors caused by lingering references to `bscTestnetRpcUrl` / `usdcAddress` on `AppConfigService` should be fixed by passing `Network` through, not by re-adding the getters.

- [ ] **Step 6: Commit**

```bash
git add src/config/env.schema.ts src/config/app-config.service.ts .env.example docs/runbook.md
git commit -m "chore(config): drop BSC env vars in favour of seeded networks table"
```

---

## Task 11: Wallet Integration Test Parameterisation

**Files:**
- Modify: `src/wallet/wallet.integration.spec.ts`

- [ ] **Step 1: Replace the integration spec with a network-aware version**

Replace `src/wallet/wallet.integration.spec.ts` with:

```ts
import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Network } from '@prisma/client';
import { config as loadEnv } from 'dotenv';
import { AppConfigService } from '../config/app-config.service';
import { NetworkRegistryService } from '../network/network-registry.service';
import { WalletService } from './wallet.service';

loadEnv();

const hasIntegrationCredentials =
  Boolean(process.env.TEST_SERVER_EOA_PRIVATE_KEY) &&
  Boolean(process.env.TEST_PIMLICO_API_KEY) &&
  Boolean(process.env.TEST_NETWORK_SLUG) &&
  Boolean(process.env.DATABASE_URL);

const describeIntegration = hasIntegrationCredentials ? describe : describe.skip;

interface IntegrationContext {
  walletService: WalletService;
  network: Network;
  cleanup: () => Promise<void>;
}

async function createIntegrationContext(): Promise<IntegrationContext> {
  const slug = process.env.TEST_NETWORK_SLUG as string;
  const databaseUrl = process.env.DATABASE_URL as string;

  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prismaClient = new PrismaClient({ adapter });
  const network = await prismaClient.network.findFirst({ where: { slug, enabled: true } });
  if (!network) {
    await prismaClient.$disconnect();
    throw new Error(`Network ${slug} not seeded or disabled`);
  }

  const configService = new ConfigService({
    PIMLICO_API_KEY: process.env.TEST_PIMLICO_API_KEY,
    SERVER_EOA_PRIVATE_KEY: process.env.TEST_SERVER_EOA_PRIVATE_KEY,
  });
  const appConfigService = new AppConfigService(configService);
  const networkRegistryService = new NetworkRegistryService(
    { network: prismaClient.network } as never,
  );
  const walletService = new WalletService(appConfigService, networkRegistryService);

  return {
    walletService,
    network,
    cleanup: async () => {
      await prismaClient.$disconnect();
    },
  };
}

describeIntegration('@integration WalletService', () => {
  it('derives deterministic smart account addresses on the seeded network', async () => {
    const context = await createIntegrationContext();
    try {
      const telegramId = 987654321n;
      const first = await context.walletService.deriveAddress(telegramId, context.network);
      const second = await context.walletService.deriveAddress(telegramId, context.network);
      expect(first).toEqual(second);
    } finally {
      await context.cleanup();
    }
  });

  it('reads a USDC balance on the seeded network', async () => {
    const context = await createIntegrationContext();
    try {
      const address = await context.walletService.deriveAddress(987654321n, context.network);
      const balance = await context.walletService.getUsdcBalance(address, context.network);
      expect(typeof balance).toBe('bigint');
    } finally {
      await context.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run the integration spec dry (it stays skipped without credentials)**

Run: `pnpm test:integration`
Expected: All `it` cases marked `@integration` are skipped (or pass if credentials are configured). No compile errors.

- [ ] **Step 3: Commit**

```bash
git add src/wallet/wallet.integration.spec.ts
git commit -m "test(wallet): parameterise integration spec on seeded TEST_NETWORK_SLUG"
```

---

## Final Verification

- [ ] **Step 1: Run lint, format, and tests in one pass**

Run: `pnpm lint && pnpm format && pnpm test && pnpm tsc -p tsconfig.build.json --noEmit`
Expected: All commands exit 0.

- [ ] **Step 2: Manual smoke test (optional, requires running bot)**

Follow `docs/runbook.md` "Manual Smoke Test", with the additional steps:

1. Send `/networks`. Expected: list shows `bsc_testnet — BSC Testnet (97) [current]`.
2. Send `/switch bsc_testnet`. Expected: `Switched to BSC Testnet (97)` and your address.
3. Send `/switch unknown`. Expected: `Unknown network. Try /networks.`
4. Send `/balance` and `/address`. Expected: replies labelled with `BSC Testnet`.

- [ ] **Step 3: Final commit if any docs/lint adjustments were needed**

```bash
git status
git add -A
git commit -m "chore: final lint and docs polish for multi-network switching"
```
