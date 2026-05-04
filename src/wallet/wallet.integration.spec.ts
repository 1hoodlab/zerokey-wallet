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
  cleanup: () => Promise<void>;
  network: Network;
  walletService: WalletService;
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
  const networkRegistryService = new NetworkRegistryService(prismaClient as never);
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
      const firstAddress = await context.walletService.deriveAddress(
        telegramId,
        context.network,
      );
      const secondAddress = await context.walletService.deriveAddress(
        telegramId,
        context.network,
      );
      expect(firstAddress).toEqual(secondAddress);
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
