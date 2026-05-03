import { Test } from '@nestjs/testing';
import type { Hex } from 'viem';
import { AppConfigService } from '../config/app-config.service';
import { WalletService } from './wallet.service';

const hasIntegrationCredentials =
  Boolean(process.env.TEST_SERVER_EOA_PRIVATE_KEY) &&
  Boolean(process.env.TEST_PIMLICO_API_KEY) &&
  Boolean(process.env.TEST_BSC_TESTNET_RPC_URL);

const describeIntegration = hasIntegrationCredentials ? describe : describe.skip;

describeIntegration('@integration WalletService', () => {
  it('derives deterministic smart account addresses', async () => {
    const service = await createService();
    const telegramId = 987654321n;

    await expect(service.deriveAddress(telegramId)).resolves.toEqual(
      await service.deriveAddress(telegramId),
    );
  });

  it('reads a BSC testnet USDC balance', async () => {
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
          bscTestnetRpcUrl:
            process.env.TEST_BSC_TESTNET_RPC_URL ??
            'https://data-seed-prebsc-1-s1.binance.org:8545',
          usdcAddress:
            (process.env.TEST_USDC_ADDRESS_BSC_TESTNET as Hex | undefined) ??
            '0xaD88B079712CC38a8D33E072CB6434E652556441',
          pimlicoApiKey: process.env.TEST_PIMLICO_API_KEY ?? 'missing',
        },
      },
    ],
  }).compile();
  await moduleRef.init();

  return moduleRef.get(WalletService);
}
