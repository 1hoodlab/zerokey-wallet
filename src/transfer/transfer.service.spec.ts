import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import type { Network } from '@prisma/client';
import { TransferStatus } from '@prisma/client';
import type { Hex } from 'viem';
import { NoPendingTransferError, OtpExpiredError, OtpInvalidError } from '../common/exceptions';
import { PrismaService } from '../database/prisma.service';
import { NetworkRegistryService } from '../network/network-registry.service';
import { OtpService } from '../otp/otp.service';
import { WalletService } from '../wallet/wallet.service';
import { TransferService } from './transfer.service';

type MockPrismaService = {
  pendingTransfer: {
    updateMany: jest.Mock;
    create: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
  };
};

type MockOtpService = {
  generateCode: jest.Mock;
  hashCode: jest.Mock;
  verifyHash: jest.Mock;
  isExpired: jest.Mock;
  getRetriesLeft: jest.Mock;
};

type MockWalletService = {
  sendUsdc: jest.Mock;
  waitForUsdcTransfer: jest.Mock;
};

type MockEventEmitter = {
  emit: jest.Mock;
};

const telegramId = 123456789n;
const recipient = '0x0000000000000000000000000000000000000001' as Hex;
const txHash = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Hex;

const pinnedNetwork: Network = {
  id: 'net-test-id',
  slug: 'bsc_testnet',
  chainId: 97,
  displayName: 'BSC Testnet',
  rpcUrl: 'https://example.test/rpc',
  usdcAddress: '0xaD88B079712CC38a8D33E072CB6434E652556441',
  enabled: true,
  createdAt: new Date(),
};

interface PendingTransferMock {
  id: string;
  telegramId: bigint;
  networkId: string;
  recipient: Hex;
  amount: string;
  otpHash: string;
  retryCount: number;
  status: TransferStatus;
  txHash: Hex | null;
  createdAt: Date;
  confirmedAt: Date | null;
}

describe('TransferService', () => {
  it('creates a new pending transfer and cancels old pending transfers', async () => {
    const prismaService = createMockPrisma();
    const otpService = createMockOtp();
    const service = await createService(prismaService, otpService);

    await expect(service.initiate(telegramId, pinnedNetwork, recipient, 100000n)).resolves.toEqual({
      transferId: 'transfer-1',
      code: '142857',
    });
    expect(prismaService.pendingTransfer.updateMany).toHaveBeenCalledWith({
      where: { telegramId, status: TransferStatus.AWAITING_OTP },
      data: { status: TransferStatus.CANCELLED },
    });
    expect(prismaService.pendingTransfer.create).toHaveBeenCalledWith({
      data: {
        telegramId,
        networkId: pinnedNetwork.id,
        recipient,
        amount: '100000',
        otpHash: 'hashed-otp',
        status: TransferStatus.AWAITING_OTP,
      },
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
    prismaService.pendingTransfer.findFirst.mockResolvedValue(
      createPendingTransfer({ createdAt: new Date(0) }),
    );
    const otpService = createMockOtp();
    otpService.isExpired.mockReturnValue(true);
    const service = await createService(prismaService, otpService);

    await expect(service.confirm(telegramId, '142857')).rejects.toBeInstanceOf(OtpExpiredError);
    expect(prismaService.pendingTransfer.update).toHaveBeenCalledWith({
      where: { id: 'transfer-1' },
      data: { status: TransferStatus.EXPIRED },
    });
  });

  it('rejects wrong OTP with retries left', async () => {
    const prismaService = createMockPrisma();
    prismaService.pendingTransfer.findFirst.mockResolvedValue(
      createPendingTransfer({ retryCount: 0 }),
    );
    const otpService = createMockOtp();
    otpService.verifyHash.mockReturnValue(false);
    otpService.getRetriesLeft.mockReturnValue(2);
    const service = await createService(prismaService, otpService);

    await expect(service.confirm(telegramId, '000000')).rejects.toMatchObject(
      new OtpInvalidError(2),
    );
    expect(prismaService.pendingTransfer.update).toHaveBeenCalledWith({
      where: { id: 'transfer-1' },
      data: { retryCount: 1 },
    });
  });

  it('cancels after the final wrong OTP attempt', async () => {
    const prismaService = createMockPrisma();
    prismaService.pendingTransfer.findFirst.mockResolvedValue(
      createPendingTransfer({ retryCount: 2 }),
    );
    const otpService = createMockOtp();
    otpService.verifyHash.mockReturnValue(false);
    otpService.getRetriesLeft.mockReturnValue(0);
    const service = await createService(prismaService, otpService);

    await expect(service.confirm(telegramId, '000000')).rejects.toMatchObject(
      new OtpInvalidError(0),
    );
    expect(prismaService.pendingTransfer.update).toHaveBeenCalledWith({
      where: { id: 'transfer-1' },
      data: { retryCount: 3, status: TransferStatus.CANCELLED },
    });
  });

  it('broadcasts a valid transfer', async () => {
    const prismaService = createMockPrisma();
    const walletService = createMockWallet();
    const service = await createService(prismaService, createMockOtp(), walletService);

    await expect(service.confirm(telegramId, '142857')).resolves.toEqual({ hash: txHash });
    expect(walletService.sendUsdc).toHaveBeenCalledWith(
      telegramId,
      pinnedNetwork,
      recipient,
      100000n,
    );
    expect(prismaService.pendingTransfer.updateMany).toHaveBeenCalledWith({
      where: { id: 'transfer-1', status: TransferStatus.AWAITING_OTP },
      data: { status: TransferStatus.BROADCASTING },
    });
    expect(prismaService.pendingTransfer.update).toHaveBeenCalledWith({
      where: { id: 'transfer-1' },
      data: { status: TransferStatus.SUBMITTED, txHash, confirmedAt: expect.any(Date) },
    });
  });

  it('does not broadcast when another confirmation already claimed the transfer', async () => {
    const prismaService = createMockPrisma();
    prismaService.pendingTransfer.updateMany.mockResolvedValueOnce({ count: 0 });
    const walletService = createMockWallet();
    const service = await createService(prismaService, createMockOtp(), walletService);

    await expect(service.confirm(telegramId, '142857')).rejects.toBeInstanceOf(
      NoPendingTransferError,
    );
    expect(walletService.sendUsdc).not.toHaveBeenCalled();
  });

  it('waits for receipt before marking a transfer confirmed', async () => {
    const prismaService = createMockPrisma();
    const walletService = createMockWallet();
    const eventEmitter = createMockEventEmitter();
    const service = await createService(
      prismaService,
      createMockOtp(),
      walletService,
      eventEmitter,
    );

    await service.pollReceipt('transfer-1', txHash);

    expect(walletService.waitForUsdcTransfer).toHaveBeenCalledWith(pinnedNetwork, txHash);
    expect(prismaService.pendingTransfer.update).toHaveBeenCalledWith({
      where: { id: 'transfer-1' },
      data: { status: TransferStatus.CONFIRMED },
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith('transfer.confirmed', {
      chatId: telegramId,
      hash: txHash,
    });
  });
});

function createMockPrisma(): MockPrismaService {
  return {
    pendingTransfer: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue(createPendingTransfer()),
      findFirst: jest.fn().mockResolvedValue(createPendingTransfer()),
      update: jest.fn().mockResolvedValue(createPendingTransfer()),
    },
  };
}

function createMockWallet(): MockWalletService {
  return {
    sendUsdc: jest.fn().mockResolvedValue(txHash),
    waitForUsdcTransfer: jest.fn().mockResolvedValue(undefined),
  };
}

function createMockEventEmitter(): MockEventEmitter {
  return { emit: jest.fn() };
}

function createMockOtp(): MockOtpService {
  return {
    generateCode: jest.fn().mockReturnValue('142857'),
    hashCode: jest.fn().mockReturnValue('hashed-otp'),
    verifyHash: jest.fn().mockReturnValue(true),
    isExpired: jest.fn().mockReturnValue(false),
    getRetriesLeft: jest.fn().mockReturnValue(2),
  };
}

function createPendingTransfer(overrides: Partial<PendingTransferMock> = {}): PendingTransferMock {
  return {
    id: 'transfer-1',
    telegramId,
    networkId: pinnedNetwork.id,
    recipient,
    amount: '100000',
    otpHash: 'hashed-otp',
    retryCount: 0,
    status: TransferStatus.AWAITING_OTP,
    txHash: null,
    createdAt: new Date(),
    confirmedAt: null,
    ...overrides,
  };
}

async function createService(
  prismaService: MockPrismaService,
  otpService: MockOtpService,
  walletService: MockWalletService = createMockWallet(),
  eventEmitter: MockEventEmitter = createMockEventEmitter(),
): Promise<TransferService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      TransferService,
      { provide: PrismaService, useValue: prismaService },
      { provide: OtpService, useValue: otpService },
      { provide: WalletService, useValue: walletService },
      {
        provide: NetworkRegistryService,
        useValue: {
          findByIdOrThrow: jest.fn().mockResolvedValue(pinnedNetwork),
        },
      },
      { provide: EventEmitter2, useValue: eventEmitter },
    ],
  }).compile();

  return moduleRef.get(TransferService);
}
