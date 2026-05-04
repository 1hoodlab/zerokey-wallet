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

  function createService(): WalletService {
    return new WalletService(
      { serverEoaPrivateKey: '0x' + '11'.repeat(32), pimlicoApiKey: 'key' } as never,
      { toViemChain: () => ({ id: network.chainId }) } as never,
    );
  }

  it('formatUsdc preserves trailing whole numbers without exponential notation', async () => {
    const service = createService();
    jest.spyOn(service, 'getUsdcDecimals').mockResolvedValue(6);

    await expect(service.formatUsdc(1_000_000n, network)).resolves.toBe('1');
    await expect(service.formatUsdc(1_500_000n, network)).resolves.toBe('1.5');
    await expect(service.formatUsdc(0n, network)).resolves.toBe('0');
    await expect(service.formatUsdc(1_234_567_891_000_000n, network)).resolves.toBe('1,234,567,891');
  });

  it('parseUsdc converts decimal strings to base units', async () => {
    const service = createService();
    jest.spyOn(service, 'getUsdcDecimals').mockResolvedValue(6);

    await expect(service.parseUsdc('1', network)).resolves.toBe(1_000_000n);
    await expect(service.parseUsdc('0.5', network)).resolves.toBe(500_000n);
  });
});
