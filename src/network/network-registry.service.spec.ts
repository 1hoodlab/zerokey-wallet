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
      {
        ...baseNetwork,
        id: 'net-2',
        slug: 'eth_sepolia',
        displayName: 'Ethereum Sepolia',
        chainId: 11155111,
      },
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
      findFirst: jest.fn(async ({ where }: { where: { slug?: string; enabled?: boolean } }) => {
        if (typeof where.slug !== 'string' || where.enabled !== true) {
          return null;
        }

        const slugNormalized = where.slug.toLowerCase();

        return (
          rows.find(
            (row) =>
              typeof row.slug === 'string' &&
              row.slug.toLowerCase() === slugNormalized &&
              row.enabled !== false,
          ) ?? null
        );
      }),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const row = rows.find((candidate) => candidate.id === where.id);
        return row ?? null;
      }),
      findMany: jest.fn(async () =>
        rows
          .filter((row) => row.enabled !== false)
          .sort((firstRow, secondRow) =>
            String(firstRow.displayName).localeCompare(String(secondRow.displayName)),
          ),
      ),
    },
  } as never;
}
