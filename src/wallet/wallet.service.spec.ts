import { Test } from '@nestjs/testing';
import { AppConfigService } from '../config/app-config.service';
import { WalletService } from './wallet.service';

describe('WalletService', () => {
  const appConfigService = {
    serverEoaPrivateKey: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    baseSepoliaRpcUrl: 'https://sepolia.base.org',
    usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
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

    expect(moduleRef.get(WalletService)).toBeInstanceOf(WalletService);
  });
});
