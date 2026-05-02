import { Test } from '@nestjs/testing';
import type { Hex } from 'viem';
import { AppConfigService } from '../config/app-config.service';
import { WalletService } from './wallet.service';

const hasIntegrationCredentials =
  Boolean(process.env.TEST_SERVER_EOA_PRIVATE_KEY) &&
  Boolean(process.env.TEST_PIMLICO_API_KEY) &&
  Boolean(process.env.TEST_BASE_SEPOLIA_RPC_URL);

const describeIntegration = hasIntegrationCredentials ? describe : describe.skip;

describeIntegration('@integration WalletService', () => {
  it('derives deterministic smart account addresses', async () => {
    const service = await createService();
    const telegramId = 987654321n;

    await expect(service.deriveAddress(telegramId)).resolves.toEqual(
      await service.deriveAddress(telegramId),
    );
  });

  it('reads a Base Sepolia USDC balance', async () => {
    const service = await createService();
    const address = await service.deriveAddress(987654321n);

    await expect(service.getUsdcBalance(address)).resolves.toEqual(expect.any(BigInt));
  });
});

async function createService(): Promise<WalletService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      WalletService,
      {
        provide: AppConfigService,
        useValue: {
          serverEoaPrivateKey: process.env.TEST_SERVER_EOA_PRIVATE_KEY as Hex,
          baseSepoliaRpcUrl: process.env.TEST_BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org',
          usdcAddress:
            (process.env.TEST_USDC_ADDRESS_BASE_SEPOLIA as Hex | undefined) ??
            '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
          pimlicoApiKey: process.env.TEST_PIMLICO_API_KEY ?? 'missing',
        },
      },
    ],
  }).compile();

  return moduleRef.get(WalletService);
}
