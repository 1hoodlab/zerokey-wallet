import type { Context } from 'grammy';
import { OtpExpiredError, OtpInvalidError } from '../../common/exceptions';
import { handleOtp } from './otp.handler';
import { handleSend } from './send.handler';

type MockContext = Context & {
  reply: jest.Mock;
  message: { text: string };
  from: { id: number };
  chat: { id: number; type: 'private' };
};

describe('bot command handlers', () => {
  const recipient = '0x0000000000000000000000000000000000000001';

  it('handleSend replies with usage for missing args', async () => {
    const ctx = createContext('/send');

    await handleSend(ctx, createAccountService(), createWalletService(), createTransferService());

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('handleSend replies with usage for extra args', async () => {
    const ctx = createContext(`/send 1 ${recipient} extra`);

    await handleSend(ctx, createAccountService(), createWalletService(), createTransferService());

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('handleSend rejects invalid recipient', async () => {
    const ctx = createContext('/send 1 nope');

    await handleSend(ctx, createAccountService(), createWalletService(), createTransferService());

    expect(ctx.reply).toHaveBeenCalledWith('Invalid Ethereum address.');
  });

  it('handleSend rejects insufficient balance', async () => {
    const ctx = createContext(`/send 1 ${recipient}`);
    const walletService = createWalletService({ balance: 100n });

    await handleSend(ctx, createAccountService(), walletService, createTransferService());

    expect(ctx.reply).toHaveBeenCalledWith('Insufficient USDC balance.');
  });

  it('handleOtp replies expired for OtpExpiredError', async () => {
    const ctx = createContext('142857');
    const transferService = {
      confirm: jest.fn().mockRejectedValue(new OtpExpiredError()),
    };

    await handleOtp(ctx, createAccountService(), transferService);

    expect(ctx.reply).toHaveBeenCalledWith('OTP expired. Start a new /send.');
  });

  it('handleOtp replies retries left for OtpInvalidError', async () => {
    const ctx = createContext('000000');
    const transferService = {
      confirm: jest.fn().mockRejectedValue(new OtpInvalidError(2)),
    };

    await handleOtp(ctx, createAccountService(), transferService);

    expect(ctx.reply).toHaveBeenCalledWith('Invalid OTP. 2 retries left.');
  });
});

function createContext(text: string): MockContext {
  return {
    message: { text },
    from: { id: 123456789 },
    chat: { id: 123456789, type: 'private' },
    reply: jest.fn(),
  } as unknown as MockContext;
}

function createAccountService() {
  return {
    getOrCreate: jest.fn().mockResolvedValue({
      address: '0x00000000000000000000000000000000075bcd15',
      isNew: false,
    }),
  };
}

function createWalletService(options: { balance?: bigint } = {}) {
  return {
    parseUsdc: jest.fn((amount: string) => BigInt(Number(amount) * 1_000_000)),
    formatUsdc: jest.fn((amountBaseUnits: bigint) =>
      (Number(amountBaseUnits) / 1_000_000).toString(),
    ),
    getUsdcBalance: jest.fn().mockResolvedValue(options.balance ?? 2_000_000n),
  };
}

function createTransferService() {
  return {
    initiate: jest.fn().mockResolvedValue({
      transferId: 'transfer-1',
      code: '142857',
    }),
  };
}
