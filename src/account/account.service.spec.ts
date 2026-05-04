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
      userNetworkAddress: {
        findUnique: jest.fn().mockResolvedValue({ telegramId, networkId: network.id, address }),
      },
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
    const createAddressRow = jest.fn().mockResolvedValue({ telegramId, networkId: network.id, address });
    const prismaService = createPrisma({
      userNetworkAddress: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: createAddressRow,
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
    expect(createAddressRow).toHaveBeenCalledWith({
      data: { telegramId, networkId: network.id, address },
    });
  });

  it('recovers from unique races by re-fetching the (user, network) row', async () => {
    const findUniqueAddress = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ telegramId, networkId: network.id, address });
    const createAddressRow = jest.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '1' }),
    );
    const prismaService = createPrisma({
      userNetworkAddress: {
        findUnique: findUniqueAddress,
        create: createAddressRow,
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
      isNew: false,
    });
  });

  it('getCurrentAccount loads user with selected network and resolves address', async () => {
    const prismaService = createPrisma({
      user: {
        findUnique: jest.fn().mockResolvedValue({ telegramId }),
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
      create: jest.fn(),
      ...(overrides.user as object | undefined),
    },
    userNetworkAddress: {
      findUnique: jest.fn(),
      create: jest.fn(),
      ...(overrides.userNetworkAddress as object | undefined),
    },
  } as never;
}
