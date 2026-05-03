import { Test } from '@nestjs/testing';
import { AppConfigService } from '../config/app-config.service';
import { WalletService } from './wallet.service';

describe('WalletService', () => {
  const appConfigService = {
    serverEoaPrivateKey: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    bscTestnetRpcUrl: 'https://data-seed-prebsc-1-s1.binance.org:8545',
    usdcAddress: '0xaD88B079712CC38a8D33E072CB6434E652556441',
    pimlicoApiKey: 'test-pimlico-api-key',
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

    const walletService = moduleRef.get(WalletService);

    expect(walletService).toBeInstanceOf(WalletService);
    expect(walletService.formatUsdc(1_500_000n)).toBe('1.5');
    expect(walletService.formatUsdc(12_345_678n)).toBe('12.345678');
    expect(walletService.formatUsdc(1_234_567_890_123_456n)).toBe('1,234,567,890.123456');
  });
});
