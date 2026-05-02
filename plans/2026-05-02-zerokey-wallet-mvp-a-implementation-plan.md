# ZeroKey Wallet MVP-A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the MVP-A custodial Telegram wallet bot for Base Sepolia USDC with deterministic per-user smart account addresses, balance lookup, OTP-confirmed sends, tests, and deployable local workflow.

**Architecture:** Implement a single NestJS 11 non-HTTP process started with `createApplicationContext()`. Keep wallet SDK integration behind `WalletService`, persistence behind Prisma/Postgres, transfer orchestration in `TransferService`, and Telegram transport in `BotService` plus focused handlers. Use `@nestjs/event-emitter` for transfer status follow-up messages so `TransferModule` never imports `BotModule`.

**Tech Stack:** Node.js >=22, TypeScript strict mode, pnpm, NestJS 11, Prisma 7, Postgres 16, grammY, Rhinestone SDK, viem, Jest, ts-jest, Pino via `nestjs-pino`, Joi, qrcode, Docker Compose.

---

## Source Spec

Implement from `docs/superpowers/specs/2026-05-02-zerokey-wallet-mvp-a-design.md`.

## File Structure

- Create: `package.json` for scripts, dependencies, engines, lint-staged config.
- Create: `pnpm-workspace.yaml` so pnpm treats the repo as a workspace root.
- Create: `tsconfig.json`, `tsconfig.build.json`, `jest.config.ts`, `.eslintrc.cjs`, `.prettierrc`, `.gitignore`.
- Create: `.env.example` with all non-secret configuration keys from the spec.
- Create: `docker-compose.yml` with Postgres 16.
- Create: `prisma/schema.prisma` with `User`, `PendingTransfer`, and `TransferStatus`.
- Create: `src/main.ts`, `src/app.module.ts`.
- Create: `src/common/exceptions.ts`, `src/common/events.ts`, `src/common/types.ts`.
- Create: `src/config/config.module.ts`, `src/config/env.schema.ts`, `src/config/app-config.service.ts`.
- Create: `src/database/database.module.ts`, `src/database/prisma.service.ts`.
- Create: `src/wallet/wallet.module.ts`, `src/wallet/wallet.service.ts`, `src/wallet/wallet.service.spec.ts`.
- Create: `src/account/account.module.ts`, `src/account/account.service.ts`, `src/account/account.service.spec.ts`.
- Create: `src/otp/otp.module.ts`, `src/otp/otp.service.ts`, `src/otp/otp.service.spec.ts`.
- Create: `src/transfer/transfer.module.ts`, `src/transfer/transfer.service.ts`, `src/transfer/transfer.service.spec.ts`.
- Create: `src/bot/bot.module.ts`, `src/bot/bot.service.ts`, `src/bot/handlers/start.handler.ts`, `src/bot/handlers/address.handler.ts`, `src/bot/handlers/balance.handler.ts`, `src/bot/handlers/send.handler.ts`, `src/bot/handlers/otp.handler.ts`, `src/bot/handlers/help.handler.ts`.
- Create: `test/fixtures/mock-prisma.ts`, `test/fixtures/mock-wallet.ts`, `test/jest-e2e.json`.
- Create: `docs/architecture.md`, `docs/runbook.md`.
- Modify: `README.md` with quick start and required security disclosure.

## Task 1: Scaffold Tooling And Runtime

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.json`
- Create: `tsconfig.build.json`
- Create: `jest.config.ts`
- Create: `.eslintrc.cjs`
- Create: `.prettierrc`
- Create: `.gitignore`

- [ ] **Step 1: Create package metadata and scripts**

Create `package.json` with this content:

```json
{
  "name": "zerokey-wallet",
  "version": "0.1.0",
  "private": true,
  "type": "commonjs",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "build": "nest build",
    "start": "node dist/main.js",
    "start:dev": "tsx watch src/main.ts",
    "lint": "eslint \"{src,test}/**/*.ts\"",
    "format": "prettier --check \"**/*.{ts,md,json,yml,yaml,prisma}\"",
    "format:write": "prettier --write \"**/*.{ts,md,json,yml,yaml,prisma}\"",
    "test": "jest --runInBand",
    "test:watch": "jest --watch",
    "test:integration": "jest --runInBand --testNamePattern='@integration'",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prepare": "husky"
  },
  "dependencies": {
    "@nestjs/common": "^11.1.19",
    "@nestjs/config": "^4.0.4",
    "@nestjs/core": "^11.1.19",
    "@nestjs/event-emitter": "^3.1.0",
    "@prisma/client": "^7.8.0",
    "@rhinestone/sdk": "^1.5.1",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.15.1",
    "grammy": "^1.42.0",
    "joi": "^18.1.2",
    "nestjs-pino": "^4.6.1",
    "pino-pretty": "^13.1.3",
    "qrcode": "^1.5.4",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.2",
    "viem": "^2.48.8"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.14",
    "@nestjs/testing": "^11.1.19",
    "@types/jest": "^30.0.0",
    "@types/node": "^25.6.0",
    "@types/qrcode": "^1.5.6",
    "@typescript-eslint/eslint-plugin": "^8.50.0",
    "@typescript-eslint/parser": "^8.50.0",
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
  },
  "lint-staged": {
    "*.{ts,md,json,yml,yaml,prisma}": [
      "prettier --write"
    ],
    "*.ts": [
      "eslint --fix"
    ]
  }
}
```

- [ ] **Step 2: Create TypeScript, Jest, ESLint, and formatting config**

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "."
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2022",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "strict": true,
    "strictNullChecks": true,
    "noImplicitAny": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "jest.config.ts"]
}
```

Create `tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "dist", "**/*.spec.ts", "test"]
}
```

Create `jest.config.ts`:

```ts
import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/**/*.module.ts'],
  coverageDirectory: 'coverage',
  testEnvironment: 'node',
};

export default config;
```

Create `.eslintrc.cjs`:

```js
module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['dist', 'coverage', 'node_modules'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-floating-promises': 'error',
  },
};
```

Create `.prettierrc`:

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100
}
```

Create `.gitignore`:

```gitignore
node_modules
dist
coverage
.env
.env.*
!.env.example
*.log
```

- [ ] **Step 3: Install dependencies**

Run:

```bash
pnpm install
```

Expected: `pnpm-lock.yaml` is created and install completes. If a peer dependency conflict appears, adjust the exact package versions according to the install error while keeping the same library choices.

- [ ] **Step 4: Verify base tooling**

Run:

```bash
pnpm lint
pnpm test
pnpm build
```

Expected: lint and build may report no matching source files until `src` exists; Jest reports no tests. Do not commit until the first source files are added in Task 2.

## Task 2: Add Configuration, Logging, And Bootstrap

**Files:**
- Create: `.env.example`
- Create: `docker-compose.yml`
- Create: `src/main.ts`
- Create: `src/app.module.ts`
- Create: `src/config/config.module.ts`
- Create: `src/config/env.schema.ts`
- Create: `src/config/app-config.service.ts`
- Create: `src/common/exceptions.ts`
- Create: `src/common/events.ts`
- Create: `src/common/types.ts`

- [ ] **Step 1: Write config validation files**

Create `.env.example`:

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

Create `src/config/env.schema.ts`:

```ts
import Joi from 'joi';

export const envSchema = Joi.object({
  DATABASE_URL: Joi.string().uri({ scheme: ['postgresql'] }).required(),
  BOT_TOKEN: Joi.string().min(10).required(),
  SERVER_EOA_PRIVATE_KEY: Joi.string().pattern(/^0x[a-fA-F0-9]{64}$/).required(),
  RHINESTONE_API_KEY: Joi.string().allow('').default(''),
  BASE_SEPOLIA_RPC_URL: Joi.string().uri().required(),
  USDC_ADDRESS_BASE_SEPOLIA: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
  OTP_TTL_SECONDS: Joi.number().integer().positive().default(300),
  OTP_MAX_RETRIES: Joi.number().integer().min(1).default(3),
  LOG_LEVEL: Joi.string().valid('fatal', 'error', 'warn', 'info', 'debug', 'trace').default('info'),
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
});
```

Create `src/config/app-config.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Hex } from 'viem';

@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService) {}

  get databaseUrl(): string {
    return this.configService.getOrThrow<string>('DATABASE_URL');
  }

  get botToken(): string {
    return this.configService.getOrThrow<string>('BOT_TOKEN');
  }

  get serverEoaPrivateKey(): Hex {
    return this.configService.getOrThrow<Hex>('SERVER_EOA_PRIVATE_KEY');
  }

  get rhinestoneApiKey(): string {
    return this.configService.getOrThrow<string>('RHINESTONE_API_KEY');
  }

  get baseSepoliaRpcUrl(): string {
    return this.configService.getOrThrow<string>('BASE_SEPOLIA_RPC_URL');
  }

  get usdcAddress(): Hex {
    return this.configService.getOrThrow<Hex>('USDC_ADDRESS_BASE_SEPOLIA');
  }

  get otpTtlSeconds(): number {
    return Number(this.configService.getOrThrow<number>('OTP_TTL_SECONDS'));
  }

  get otpMaxRetries(): number {
    return Number(this.configService.getOrThrow<number>('OTP_MAX_RETRIES'));
  }

  get logLevel(): string {
    return this.configService.getOrThrow<string>('LOG_LEVEL');
  }
}
```

Create `src/config/config.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { AppConfigService } from './app-config.service';
import { envSchema } from './env.schema';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envSchema,
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class ConfigModule {}
```

- [ ] **Step 2: Add bootstrap, logging, and shared types**

Create `src/common/exceptions.ts`:

```ts
export class InsufficientBalanceError extends Error {
  constructor() {
    super('Insufficient USDC balance');
  }
}

export class NoPendingTransferError extends Error {
  constructor() {
    super('No pending transfer');
  }
}

export class OtpExpiredError extends Error {
  constructor() {
    super('OTP expired');
  }
}

export class OtpInvalidError extends Error {
  constructor(public readonly retriesLeft: number) {
    super('Invalid OTP');
  }
}

export class TooManyOtpAttemptsError extends Error {
  constructor() {
    super('Too many OTP attempts');
  }
}

export class WalletNetworkError extends Error {
  constructor(message = 'Wallet network error') {
    super(message);
  }
}
```

Create `src/common/events.ts`:

```ts
import type { Hex } from 'viem';

export const TRANSFER_CONFIRMED_EVENT = 'transfer.confirmed';
export const TRANSFER_FAILED_EVENT = 'transfer.failed';

export interface TransferStatusEvent {
  chatId: bigint;
  hash: Hex;
  reason?: string;
}
```

Create `src/common/types.ts`:

```ts
import type { Hex } from 'viem';

export interface DerivedAccount {
  telegramId: bigint;
  address: Hex;
}

export interface TransferRequest {
  telegramId: bigint;
  recipientAddress: Hex;
  amountBaseUnits: bigint;
}
```

Create `src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module';

@Module({
  imports: [
    ConfigModule,
    EventEmitterModule.forRoot(),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        redact: ['*.privateKey', '*.otp', '*.otpHash', 'req.headers.authorization'],
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : {
                target: 'pino-pretty',
              },
      },
    }),
  ],
})
export class AppModule {}
```

Create `src/main.ts`:

```ts
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
  });

  process.on('SIGTERM', () => {
    void app.close();
  });

  process.on('uncaughtException', (error) => {
    logger.fatal(error);
    process.exit(1);
  });

  process.on('unhandledRejection', (error) => {
    logger.fatal(error);
    process.exit(1);
  });
}

void bootstrap();
```

Create `docker-compose.yml`:

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

- [ ] **Step 3: Verify bootstrap compiles**

Run:

```bash
pnpm lint
pnpm build
```

Expected: both commands pass.

- [ ] **Step 4: Commit configuration baseline**

Run:

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.build.json jest.config.ts .eslintrc.cjs .prettierrc .gitignore .env.example docker-compose.yml src
git commit -m "chore: scaffold NestJS wallet runtime"
```

## Task 3: Add Prisma Schema And Database Module

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/database/database.module.ts`
- Create: `src/database/prisma.service.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Create Prisma schema**

Create `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  telegramId BigInt            @id @map("telegram_id")
  address    String            @unique
  createdAt  DateTime          @default(now()) @map("created_at")
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

- [ ] **Step 2: Add Prisma service**

Create `src/database/prisma.service.ts`:

```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

Create `src/database/database.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
```

Modify `src/app.module.ts` to include `DatabaseModule` in imports:

```ts
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    EventEmitterModule.forRoot(),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        redact: ['*.privateKey', '*.otp', '*.otpHash', 'req.headers.authorization'],
      },
    }),
  ],
})
export class AppModule {}
```

- [ ] **Step 3: Generate Prisma client**

Run:

```bash
cp .env.example .env
pnpm prisma generate
```

Expected: Prisma client generation succeeds.

- [ ] **Step 4: Run migration locally**

Run:

```bash
docker compose up -d postgres
pnpm prisma migrate dev --name init
```

Expected: migration SQL is created under `prisma/migrations` and Postgres contains `users`, `pending_transfers`, and the enum.

- [ ] **Step 5: Verify and commit database layer**

Run:

```bash
pnpm lint
pnpm build
git add prisma src/database src/app.module.ts
git commit -m "feat: add Prisma database layer"
```

## Task 4: Implement Wallet Module

**Files:**
- Create: `src/wallet/wallet.module.ts`
- Create: `src/wallet/wallet.service.ts`
- Create: `src/wallet/wallet.service.spec.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Write WalletService tests around public behavior**

Create `src/wallet/wallet.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { WalletService } from './wallet.service';
import { AppConfigService } from '../config/app-config.service';

describe('WalletService', () => {
  const appConfigService = {
    serverEoaPrivateKey: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    baseSepoliaRpcUrl: 'https://sepolia.base.org',
    usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    rhinestoneApiKey: '',
  };

  it('creates a service with validated config', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        WalletService,
        {
          provide: AppConfigService,
          useValue: appConfigService,
        },
      ],
    }).compile();

    expect(moduleRef.get(WalletService)).toBeInstanceOf(WalletService);
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
pnpm test src/wallet/wallet.service.spec.ts
```

Expected: FAIL because `WalletService` does not exist.

- [ ] **Step 3: Implement wallet anti-corruption layer**

Create `src/wallet/wallet.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  parseUnits,
  type Hex,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { RhinestoneSDK } from '@rhinestone/sdk';
import { AppConfigService } from '../config/app-config.service';
import { WalletNetworkError } from '../common/exceptions';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);
  private readonly publicClient;
  private readonly rhinestone: RhinestoneSDK;
  private readonly serverAccount;

  constructor(private readonly appConfigService: AppConfigService) {
    this.publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(this.appConfigService.baseSepoliaRpcUrl),
    });
    this.rhinestone = new RhinestoneSDK({
      apiKey: this.appConfigService.rhinestoneApiKey,
    });
    this.serverAccount = privateKeyToAccount(this.appConfigService.serverEoaPrivateKey);
  }

  async deriveAddress(telegramId: bigint): Promise<Hex> {
    const account = await this.createSmartAccount(telegramId);
    return getAddress(account.getAddress());
  }

  async getUsdcBalance(address: Hex): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.appConfigService.usdcAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
    });
  }

  formatUsdc(amountBaseUnits: bigint): string {
    return formatUnits(amountBaseUnits, 6);
  }

  parseUsdc(amount: string): bigint {
    return parseUnits(amount, 6);
  }

  async sendUsdc(
    telegramId: bigint,
    recipientAddress: Hex,
    amountBaseUnits: bigint,
  ): Promise<Hex> {
    return this.withSingleRetry(async () => {
      const account = await this.createSmartAccount(telegramId);
      const transaction = await account.sendTransaction({
        chain: baseSepolia,
        calls: [
          {
            to: this.appConfigService.usdcAddress,
            value: 0n,
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: 'transfer',
              args: [recipientAddress, amountBaseUnits],
            }),
          },
        ],
      });

      return transaction.hash;
    });
  }

  private async createSmartAccount(telegramId: bigint) {
    return this.rhinestone.createAccount({
      owners: {
        type: 'ecdsa',
        accounts: [this.serverAccount],
      },
      account: {
        nonce: telegramId,
      },
    });
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

Create `src/wallet/wallet.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { WalletService } from './wallet.service';

@Module({
  imports: [ConfigModule],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
```

Modify `src/app.module.ts` to import `WalletModule`.

- [ ] **Step 4: Verify SDK type names against installed declarations**

Open installed `@rhinestone/sdk` TypeScript declarations from `node_modules/@rhinestone/sdk`. Keep the behavior above, and adjust only import names or returned transaction property names if the installed SDK version differs. Keep the method signature:

```ts
async sendUsdc(telegramId: bigint, recipientAddress: Hex, amountBaseUnits: bigint): Promise<Hex>
```

Expected behavior:
- The smart account uses the single server EOA owner plus `account.nonce = telegramId`.
- Counterfactual account deployment is bundled into the first send.
- Bundler or RPC failure retries once after a 2 second delay.
- Server EOA out of gas logs at `fatal` or `error` and throws `WalletNetworkError`.

- [ ] **Step 5: Verify and commit wallet layer**

Run:

```bash
pnpm test src/wallet/wallet.service.spec.ts
pnpm lint
pnpm build
git add src/wallet src/app.module.ts
git commit -m "feat: add wallet service boundary"
```

## Task 5: Implement Account Module

**Files:**
- Create: `src/account/account.module.ts`
- Create: `src/account/account.service.ts`
- Create: `src/account/account.service.spec.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Write AccountService tests**

Create `src/account/account.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { AccountService } from './account.service';
import { PrismaService } from '../database/prisma.service';
import { WalletService } from '../wallet/wallet.service';

describe('AccountService', () => {
  const telegramId = 123456789n;
  const address = '0x00000000000000000000000000000000075bcd15';

  it('returns an existing account without deriving a new address', async () => {
    const prismaService = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ telegramId, address, createdAt: new Date() }),
      },
    };
    const walletService = { deriveAddress: jest.fn() };
    const service = await createService(prismaService, walletService);

    await expect(service.getOrCreate(telegramId)).resolves.toEqual({ address, isNew: false });
    expect(walletService.deriveAddress).not.toHaveBeenCalled();
  });

  it('derives and creates an account for a new telegram user', async () => {
    const prismaService = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ telegramId, address, createdAt: new Date() }),
      },
    };
    const walletService = { deriveAddress: jest.fn().mockResolvedValue(address) };
    const service = await createService(prismaService, walletService);

    await expect(service.getOrCreate(telegramId)).resolves.toEqual({ address, isNew: true });
    expect(prismaService.user.create).toHaveBeenCalledWith({ data: { telegramId, address } });
  });

  it('recovers from unique races by re-fetching the account', async () => {
    const uniqueError = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const prismaService = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ telegramId, address, createdAt: new Date() }),
        create: jest.fn().mockRejectedValue(uniqueError),
      },
    };
    const walletService = { deriveAddress: jest.fn().mockResolvedValue(address) };
    const service = await createService(prismaService, walletService);

    await expect(service.getOrCreate(telegramId)).resolves.toEqual({ address, isNew: false });
  });
});

async function createService(prismaService: object, walletService: object): Promise<AccountService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      AccountService,
      { provide: PrismaService, useValue: prismaService },
      { provide: WalletService, useValue: walletService },
    ],
  }).compile();

  return moduleRef.get(AccountService);
}
```

- [ ] **Step 2: Run failing account tests**

Run:

```bash
pnpm test src/account/account.service.spec.ts
```

Expected: FAIL because `AccountService` does not exist.

- [ ] **Step 3: Implement AccountService**

Create `src/account/account.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Hex } from 'viem';
import { PrismaService } from '../database/prisma.service';
import { WalletService } from '../wallet/wallet.service';

export interface AccountResult {
  address: Hex;
  isNew: boolean;
}

@Injectable()
export class AccountService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly walletService: WalletService,
  ) {}

  async getOrCreate(telegramId: bigint): Promise<AccountResult> {
    const existingUser = await this.prismaService.user.findUnique({ where: { telegramId } });
    if (existingUser) {
      return { address: existingUser.address as Hex, isNew: false };
    }

    const address = await this.walletService.deriveAddress(telegramId);

    try {
      await this.prismaService.user.create({ data: { telegramId, address } });
      return { address, isNew: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const racedUser = await this.prismaService.user.findUniqueOrThrow({ where: { telegramId } });
        return { address: racedUser.address as Hex, isNew: false };
      }

      throw error;
    }
  }
}
```

Create `src/account/account.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { AccountService } from './account.service';

@Module({
  imports: [WalletModule],
  providers: [AccountService],
  exports: [AccountService],
})
export class AccountModule {}
```

Modify `src/app.module.ts` to import `AccountModule`.

- [ ] **Step 4: Verify and commit account layer**

Run:

```bash
pnpm test src/account/account.service.spec.ts
pnpm lint
pnpm build
git add src/account src/app.module.ts
git commit -m "feat: add deterministic account service"
```

## Task 6: Implement OTP Module

**Files:**
- Create: `src/otp/otp.module.ts`
- Create: `src/otp/otp.service.ts`
- Create: `src/otp/otp.service.spec.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Write OTP tests**

Create `src/otp/otp.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { OtpService } from './otp.service';
import { AppConfigService } from '../config/app-config.service';

describe('OtpService', () => {
  it('generates six numeric digits', async () => {
    const service = await createService();
    const otp = service.generateCode();

    expect(otp).toMatch(/^\d{6}$/);
  });

  it('hashes and verifies matching codes', async () => {
    const service = await createService();
    const hash = service.hashCode('142857');

    expect(service.verifyHash('142857', hash)).toBe(true);
    expect(service.verifyHash('000000', hash)).toBe(false);
  });

  it('detects expired creation times', async () => {
    const service = await createService();
    const createdAt = new Date(Date.now() - 301_000);

    expect(service.isExpired(createdAt)).toBe(true);
  });

  it('reports retries left after a wrong attempt', async () => {
    const service = await createService();

    expect(service.getRetriesLeft(1)).toBe(2);
    expect(service.getRetriesLeft(3)).toBe(0);
  });
});

async function createService(): Promise<OtpService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      OtpService,
      {
        provide: AppConfigService,
        useValue: {
          otpTtlSeconds: 300,
          otpMaxRetries: 3,
        },
      },
    ],
  }).compile();

  return moduleRef.get(OtpService);
}
```

- [ ] **Step 2: Run failing OTP tests**

Run:

```bash
pnpm test src/otp/otp.service.spec.ts
```

Expected: FAIL because `OtpService` does not exist.

- [ ] **Step 3: Implement OTP service**

Create `src/otp/otp.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class OtpService {
  constructor(private readonly appConfigService: AppConfigService) {}

  generateCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  hashCode(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  verifyHash(code: string, expectedHash: string): boolean {
    const actualHash = this.hashCode(code);
    const actualBuffer = Buffer.from(actualHash, 'hex');
    const expectedBuffer = Buffer.from(expectedHash, 'hex');

    if (actualBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(actualBuffer, expectedBuffer);
  }

  isExpired(createdAt: Date): boolean {
    const ageMilliseconds = Date.now() - createdAt.getTime();
    return ageMilliseconds > this.appConfigService.otpTtlSeconds * 1000;
  }

  getRetriesLeft(retryCountAfterFailure: number): number {
    return Math.max(this.appConfigService.otpMaxRetries - retryCountAfterFailure, 0);
  }
}
```

Create `src/otp/otp.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { OtpService } from './otp.service';

@Module({
  imports: [ConfigModule],
  providers: [OtpService],
  exports: [OtpService],
})
export class OtpModule {}
```

Modify `src/app.module.ts` to import `OtpModule`.

- [ ] **Step 4: Verify and commit OTP layer**

Run:

```bash
pnpm test src/otp/otp.service.spec.ts
pnpm lint
pnpm build
git add src/otp src/app.module.ts
git commit -m "feat: add OTP service"
```

## Task 7: Implement Transfer Module

**Files:**
- Create: `src/transfer/transfer.module.ts`
- Create: `src/transfer/transfer.service.ts`
- Create: `src/transfer/transfer.service.spec.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Write transfer service tests**

Create `src/transfer/transfer.service.spec.ts` with tests for:
- `initiate` cancels previous `AWAITING_OTP` transfers and creates a new pending transfer.
- `confirm` throws `NoPendingTransferError` when no transfer exists.
- `confirm` expires old transfers.
- `confirm` increments retry count for wrong OTP and returns retries left.
- `confirm` cancels after three wrong OTP attempts.
- `confirm` broadcasts on valid OTP and stores `txHash`.

Use this test scaffold:

```ts
import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TransferStatus } from '@prisma/client';
import { TransferService } from './transfer.service';
import { NoPendingTransferError, OtpExpiredError, OtpInvalidError } from '../common/exceptions';
import { PrismaService } from '../database/prisma.service';
import { OtpService } from '../otp/otp.service';
import { WalletService } from '../wallet/wallet.service';

describe('TransferService', () => {
  const telegramId = 123456789n;
  const recipient = '0x0000000000000000000000000000000000000001';
  const txHash = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  it('creates a new pending transfer and cancels old pending transfers', async () => {
    const prismaService = createMockPrisma();
    const otpService = createMockOtp();
    const service = await createService(prismaService, otpService);

    await expect(service.initiate(telegramId, recipient, 100000n)).resolves.toEqual({
      transferId: 'transfer-1',
      code: '142857',
    });
    expect(prismaService.pendingTransfer.updateMany).toHaveBeenCalledWith({
      where: { telegramId, status: TransferStatus.AWAITING_OTP },
      data: { status: TransferStatus.CANCELLED },
    });
  });

  it('rejects confirmation when no transfer is pending', async () => {
    const prismaService = createMockPrisma();
    prismaService.pendingTransfer.findFirst.mockResolvedValue(null);
    const service = await createService(prismaService, createMockOtp());

    await expect(service.confirm(telegramId, '142857')).rejects.toBeInstanceOf(
      NoPendingTransferError,
    );
  });

  it('expires stale OTP confirmations', async () => {
    const prismaService = createMockPrisma();
    prismaService.pendingTransfer.findFirst.mockResolvedValue(createPendingTransfer({ createdAt: new Date(0) }));
    const otpService = createMockOtp();
    otpService.isExpired.mockReturnValue(true);
    const service = await createService(prismaService, otpService);

    await expect(service.confirm(telegramId, '142857')).rejects.toBeInstanceOf(OtpExpiredError);
  });

  it('rejects wrong OTP with retries left', async () => {
    const prismaService = createMockPrisma();
    prismaService.pendingTransfer.findFirst.mockResolvedValue(createPendingTransfer({ retryCount: 0 }));
    const otpService = createMockOtp();
    otpService.verifyHash.mockReturnValue(false);
    otpService.getRetriesLeft.mockReturnValue(2);
    const service = await createService(prismaService, otpService);

    await expect(service.confirm(telegramId, '000000')).rejects.toMatchObject(
      new OtpInvalidError(2),
    );
  });

  it('broadcasts a valid transfer', async () => {
    const prismaService = createMockPrisma();
    const walletService = { sendUsdc: jest.fn().mockResolvedValue(txHash) };
    const service = await createService(prismaService, createMockOtp(), walletService);

    await expect(service.confirm(telegramId, '142857')).resolves.toEqual({ hash: txHash });
  });
});
```

Add local helper functions in the same spec file with concrete mock objects that implement every Prisma method used by the service.

- [ ] **Step 2: Run failing transfer tests**

Run:

```bash
pnpm test src/transfer/transfer.service.spec.ts
```

Expected: FAIL because `TransferService` does not exist.

- [ ] **Step 3: Implement TransferService**

Create `src/transfer/transfer.service.ts` with these public methods:

```ts
export interface InitiatedTransfer {
  transferId: string;
  code: string;
}

export interface SubmittedTransfer {
  hash: Hex;
}

async initiate(telegramId: bigint, recipientAddress: Hex, amountBaseUnits: bigint): Promise<InitiatedTransfer>
async confirm(telegramId: bigint, code: string): Promise<SubmittedTransfer>
async pollReceipt(transferId: string, hash: Hex): Promise<void>
```

Required implementation behavior:
- `initiate` uses `crypto.randomUUID()` only if Prisma schema is not generating the id for the create call.
- `initiate` cancels existing `AWAITING_OTP` rows for that `telegramId`.
- `initiate` stores `amountBaseUnits.toString()`, `otpHash`, `recipient`, and `AWAITING_OTP`.
- `confirm` reads the latest `AWAITING_OTP` row for `telegramId`.
- Expired rows move to `EXPIRED` and throw `OtpExpiredError`.
- Wrong OTP increments `retryCount`; at max retries status becomes `CANCELLED`.
- Valid OTP moves to `BROADCASTING`, calls `WalletService.sendUsdc(telegramId, recipient, amount)`, then stores `SUBMITTED` and `txHash`.
- Broadcast failure stores `FAILED` and rethrows.
- `pollReceipt` emits `TRANSFER_CONFIRMED_EVENT` or `TRANSFER_FAILED_EVENT`; `chatId` is `telegramId`.

- [ ] **Step 4: Create transfer module and import it**

Create `src/transfer/transfer.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { OtpModule } from '../otp/otp.module';
import { WalletModule } from '../wallet/wallet.module';
import { TransferService } from './transfer.service';

@Module({
  imports: [OtpModule, WalletModule],
  providers: [TransferService],
  exports: [TransferService],
})
export class TransferModule {}
```

Modify `src/app.module.ts` to import `TransferModule`.

- [ ] **Step 5: Verify and commit transfer layer**

Run:

```bash
pnpm test src/transfer/transfer.service.spec.ts
pnpm lint
pnpm build
git add src/transfer src/app.module.ts
git commit -m "feat: add OTP-gated transfer orchestration"
```

## Task 8: Implement Bot Module And Handlers

**Files:**
- Create: `src/bot/bot.module.ts`
- Create: `src/bot/bot.service.ts`
- Create: `src/bot/handlers/start.handler.ts`
- Create: `src/bot/handlers/address.handler.ts`
- Create: `src/bot/handlers/balance.handler.ts`
- Create: `src/bot/handlers/send.handler.ts`
- Create: `src/bot/handlers/otp.handler.ts`
- Create: `src/bot/handlers/help.handler.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Add BotService lifecycle and private-chat middleware**

Create `src/bot/bot.service.ts` with `OnModuleInit` and `OnModuleDestroy`. The service must:
- Construct `new Bot(this.appConfigService.botToken)`.
- Reject non-private chats with a short reply.
- Register `/start`, `/address`, `/balance`, `/send`, `/help`, and six-digit OTP text handlers.
- Register `bot.catch` to log and reply `Something went wrong. Try again or /help.`.
- Start long-polling in `onModuleInit()` with `bot.start()`.
- Stop long-polling in `onModuleDestroy()` with `bot.stop()`.
- Listen for `TRANSFER_CONFIRMED_EVENT` and `TRANSFER_FAILED_EVENT` with `@OnEvent`.

- [ ] **Step 2: Implement focused command handlers**

Create handlers with one exported function per file:

```ts
export async function handleStart(ctx: Context, accountService: AccountService): Promise<void>
export async function handleAddress(ctx: Context, accountService: AccountService): Promise<void>
export async function handleBalance(ctx: Context, accountService: AccountService, walletService: WalletService): Promise<void>
export async function handleSend(ctx: Context, accountService: AccountService, walletService: WalletService, transferService: TransferService): Promise<void>
export async function handleOtp(ctx: Context, accountService: AccountService, transferService: TransferService): Promise<void>
export async function handleHelp(ctx: Context): Promise<void>
```

Handler behavior:
- `/start` calls `AccountService.getOrCreate()` and replies with the address and testnet warning.
- `/address` sends QR PNG from `qrcode.toBuffer(address)` and includes the address as caption.
- `/balance` formats USDC with six decimals.
- `/send` validates exactly two args: amount and `0x` recipient.
- `/send` rejects invalid address, zero address, own address, non-positive amount, and insufficient balance.
- `/send` calls `TransferService.initiate()` and replies with amount, recipient, OTP code, and 5 minute expiry.
- OTP handler matches only `/^\d{6}$/` and maps typed exceptions to clear replies.
- `/help` lists supported commands and says the bot is testnet-only.

- [ ] **Step 3: Create BotModule and import it**

Create `src/bot/bot.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AccountModule } from '../account/account.module';
import { ConfigModule } from '../config/config.module';
import { OtpModule } from '../otp/otp.module';
import { TransferModule } from '../transfer/transfer.module';
import { WalletModule } from '../wallet/wallet.module';
import { BotService } from './bot.service';

@Module({
  imports: [AccountModule, ConfigModule, OtpModule, TransferModule, WalletModule],
  providers: [BotService],
})
export class BotModule {}
```

Modify `src/app.module.ts` to import `BotModule`.

- [ ] **Step 4: Add bot handler tests**

Create at least these Jest cases:
- `handleSend` replies usage for missing args.
- `handleSend` rejects invalid recipient.
- `handleSend` rejects insufficient balance.
- `handleOtp` replies expired for `OtpExpiredError`.
- `handleOtp` replies retries left for `OtpInvalidError`.

Run:

```bash
pnpm test src/bot
```

Expected: bot handler tests pass without starting long-polling.

- [ ] **Step 5: Verify and commit bot layer**

Run:

```bash
pnpm test
pnpm lint
pnpm build
git add src/bot src/app.module.ts
git commit -m "feat: add Telegram bot command handlers"
```

## Task 9: Add Documentation And Security Disclosure

**Files:**
- Modify: `README.md`
- Create: `docs/architecture.md`
- Create: `docs/runbook.md`

- [ ] **Step 1: Update README**

Replace `README.md` with sections:
- `# zerokey-wallet`
- `## Quick Start` with `pnpm install`, `cp .env.example .env`, `docker compose up -d postgres`, `pnpm prisma migrate dev --name init`, `pnpm start:dev`.
- `## Commands` documenting `/start`, `/address`, `/balance`, `/send <amount> <0x-address>`, `/help`.
- `## Security Disclosure` with these exact limitations:
  - MVP-A is custodial on Base Sepolia testnet only.
  - Bot server holds all keys; server compromise can drain all wallets.
  - OTP is sent through the same Telegram chat and prevents typos, not Telegram account takeover.
  - There is no recovery flow; losing Telegram account access can lose wallet access.
  - Only USDC on Base Sepolia is supported.
  - Gas is not sponsored; users need Base Sepolia ETH.
  - Do not use MVP-A on mainnet.

- [ ] **Step 2: Add architecture doc**

Create `docs/architecture.md` with:
- Single-process trust boundary.
- Module table from the spec.
- Data flow for `/start`, `/address`, `/balance`, and `/send`.
- Note that `telegramId === chatId` only holds because private chats are enforced.
- Note that `TransferService` emits events and `BotService` sends follow-up messages.

- [ ] **Step 3: Add runbook**

Create `docs/runbook.md` with:
- How to start Postgres.
- How to migrate Prisma.
- How to refill the server EOA with Base Sepolia ETH.
- How to query stuck transfers with Prisma Studio or SQL.
- How to inspect logs for `FAILED`, `TIMEOUT`, and EOA gas errors.

- [ ] **Step 4: Verify and commit docs**

Run:

```bash
pnpm format
git add README.md docs/architecture.md docs/runbook.md
git commit -m "docs: add MVP-A setup and operations guide"
```

## Task 10: Final Verification And MVP-A Acceptance

**Files:**
- Modify only files required by failures found during verification.

- [ ] **Step 1: Run automated verification**

Run:

```bash
pnpm install
docker compose up -d postgres
pnpm prisma migrate dev --name init
pnpm prisma generate
pnpm test
pnpm lint
pnpm build
```

Expected: every command exits with status 0.

- [ ] **Step 2: Run WalletService integration test when credentials are available**

Add `describe('@integration WalletService', ...)` tests that:
- Derive the same address for the same Telegram id.
- Read USDC balance from Base Sepolia.
- Send a tiny USDC amount from a funded test account if test funds are available.

Run:

```bash
pnpm test:integration
```

Expected: integration tests pass when `.env.test` has funded test credentials. If credentials are not available, document that this gate is blocked by missing funded testnet credentials in the PR or handoff.

- [ ] **Step 3: Run manual E2E smoke test**

Run:

```bash
pnpm start:dev
```

In a private chat with the test bot:
- Send `/start`; expect a valid `0x` address.
- Send `/start` again; expect the same address.
- Send `/address`; expect QR image plus text address.
- Fund address with Base Sepolia ETH and USDC.
- Send `/balance`; expect current USDC amount.
- Send `/send 0.1 0x0000000000000000000000000000000000000001`; expect OTP challenge.
- Reply with the OTP; expect submitted transaction and later confirmed or timeout follow-up.
- Start another send and reply wrong OTP three times; expect cancellation.
- Start another send and wait more than 5 minutes; expect expiry when confirming.

- [ ] **Step 4: Check acceptance criteria**

Confirm each item from spec section 11:
- `pnpm install && docker compose up && pnpm start:dev` runs without error.
- `/start` returns a valid address.
- `/start` is idempotent per Telegram user.
- `/address` returns QR and text.
- `/balance` queries Base Sepolia USDC.
- `/send` validates, OTP confirms, broadcasts, and sends event status.
- Wrong OTP three times cancels.
- Expired OTP expires.
- New `/send` cancels old pending transfer.
- Unit coverage meets the service targets.
- Wallet integration test passes when credentials are present.
- Manual E2E smoke passes.
- README contains the security disclosure.
- Bot runs continuously under light load.

- [ ] **Step 5: Commit verification fixes**

If any verification edit was needed, run:

```bash
git add .
git commit -m "fix: stabilize MVP-A verification"
```

If no edits were needed, do not create an empty commit.

## Self-Review Notes

- Spec coverage: This plan covers setup, NestJS modules, Prisma schema, deterministic accounts, OTP, transfer orchestration, bot commands, docs, and acceptance verification from the design spec.
- Scope check: The plan is focused on MVP-A only. Recovery, mainnet hardening, sponsored gas, webhooks, external alerting, smart sessions, and multi-token support remain out of scope.
- Implementation risk: `WalletService.sendUsdc` depends on the installed `@rhinestone/sdk` API. The implementer must wire that method against the installed SDK declarations before Task 4 is considered complete.
- Verification risk: Base Sepolia integration and manual E2E require funded test credentials and a Telegram bot token.

