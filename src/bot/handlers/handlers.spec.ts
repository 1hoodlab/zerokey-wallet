import type { Context } from 'grammy';
import { OtpExpiredError, OtpInvalidError } from '../../common/exceptions';
import { handleNetworks } from './networks.handler';
import { handleOtp } from './otp.handler';
import { handleSend } from './send.handler';
import { handleSwitch } from './switch.handler';

type MockContext = Context & {
  reply: jest.Mock;
  message: { text: string };
  from: { id: number };
  chat: { id: number; type: 'private' };
};

describe('bot command handlers', () => {
  const recipient = '0x0000000000000000000000000000000000000001';

  const sampleNetwork = {
    id: 'net-1',
    slug: 'bsc_testnet',
    chainId: 97,
    displayName: 'BSC Testnet',
    rpcUrl: 'https://example.test/rpc',
    usdcAddress: '0xd73d3E44a6184179cd9c09cb2e2647981b716568',
    enabled: true,
    createdAt: new Date(),
  };

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

  it('handleSend wraps OTP in Telegram spoiler (HTML)', async () => {
    const ctx = createContext(`/send 1 ${recipient}`);

    await handleSend(ctx, createAccountService(), createWalletService(), createTransferService());

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringMatching(/OTP: <tg-spoiler>\d{6}<\/tg-spoiler>/),
      { parse_mode: 'HTML' },
    );
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

  describe('/networks handler', () => {
    it('lists enabled networks with the user current selection marked', async () => {
      const ctx = createContext('/networks');
      const accountService = {
        getCurrentAccount: jest.fn().mockResolvedValue({
          address: '0x00000000000000000000000000000000075bcd15',
          network: {
            id: 'net-1',
            slug: 'bsc_testnet',
            displayName: 'BSC Testnet',
            chainId: 97,
          },
          isNew: false,
        }),
      };
      const networkRegistryService = {
        listEnabled: jest.fn().mockResolvedValue([
          sampleNetwork,
          {
            ...sampleNetwork,
            id: 'net-2',
            slug: 'eth_sepolia',
            displayName: 'Ethereum Sepolia',
            chainId: 11155111,
          },
        ]),
      };

      await handleNetworks(ctx, accountService as never, networkRegistryService as never);

      const replyText = ctx.reply.mock.calls[0][0] as string;
      expect(replyText).toContain('• bsc_testnet — BSC Testnet (97) [current]');
      expect(replyText).toContain('• eth_sepolia — Ethereum Sepolia (11155111)');
    });
  });

  describe('/switch handler', () => {
    const listedNetwork = {
      id: 'net-1',
      slug: 'bsc_testnet',
      displayName: 'BSC Testnet',
      chainId: 97,
      rpcUrl: 'https://example.test/rpc',
      usdcAddress: '0xd73d3E44a6184179cd9c09cb2e2647981b716568',
      enabled: true,
      createdAt: new Date(),
    };

    it('replies with the new network and address on success', async () => {
      const ctx = createContext('/switch BSC_Testnet');
      const accountService = {
        switchNetwork: jest.fn().mockResolvedValue({
          address: '0x00000000000000000000000000000000075bcd15',
          network: listedNetwork,
          isNew: false,
        }),
      };
      const networkRegistryService = {
        findBySlug: jest.fn().mockResolvedValue(listedNetwork),
        listEnabled: jest.fn().mockResolvedValue([listedNetwork]),
      };

      await handleSwitch(ctx, accountService as never, networkRegistryService as never);

      expect(networkRegistryService.findBySlug).toHaveBeenCalledWith('BSC_Testnet');
      expect(accountService.switchNetwork).toHaveBeenCalledWith(123456789n, listedNetwork);
      const replyText = ctx.reply.mock.calls[0][0] as string;
      expect(replyText).toContain('Switched to BSC Testnet (97)');
      expect(replyText).toContain('0x00000000000000000000000000000000075bcd15');
    });

    it('rejects unknown slug with usage hint', async () => {
      const ctx = createContext('/switch nope');
      const accountService = { switchNetwork: jest.fn() };
      const networkRegistryService = {
        findBySlug: jest.fn().mockResolvedValue(null),
        listEnabled: jest.fn().mockResolvedValue([
          {
            ...listedNetwork,
            id: 'net-1',
            slug: 'bsc_testnet',
            displayName: 'BSC Testnet',
            chainId: 97,
          },
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
    getCurrentAccount: jest.fn().mockResolvedValue({
      address: '0x00000000000000000000000000000000075bcd15',
      network: {
        id: 'net-1',
        slug: 'bsc_testnet',
        chainId: 97,
        displayName: 'BSC Testnet',
        rpcUrl: 'https://example.test/rpc',
        usdcAddress: '0xd73d3E44a6184179cd9c09cb2e2647981b716568',
        enabled: true,
        createdAt: new Date(),
      },
      isNew: false,
    }),
    ensureUserOnDefaultNetwork: jest.fn(),
    switchNetwork: jest.fn(),
  };
}

function createWalletService(options: { balance?: bigint } = {}) {
  const decimals = 6;
  return {
    parseUsdc: jest.fn(async (amount: string) => BigInt(Number(amount) * 10 ** decimals)),
    formatUsdc: jest.fn(async (amountBaseUnits: bigint) =>
      (Number(amountBaseUnits) / 10 ** decimals).toString(),
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
