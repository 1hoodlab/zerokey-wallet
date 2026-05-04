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
