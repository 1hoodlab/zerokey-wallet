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
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ telegramId, address, createdAt: new Date() }),
      },
    };
    const walletService = { deriveAddress: jest.fn().mockResolvedValue(address) };
    const service = await createService(prismaService, walletService);

    await expect(service.getOrCreate(telegramId)).resolves.toEqual({ address, isNew: false });
  });
});

async function createService(
  prismaService: object,
  walletService: object,
): Promise<AccountService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      AccountService,
      { provide: PrismaService, useValue: prismaService },
      { provide: WalletService, useValue: walletService },
    ],
  }).compile();

  return moduleRef.get(AccountService);
}
