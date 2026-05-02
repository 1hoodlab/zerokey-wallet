import { Injectable, Logger } from '@nestjs/common';
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  parseUnits,
  type Hex,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { entryPoint07Address, type SmartAccount } from 'viem/account-abstraction';
import { createSmartAccountClient } from 'permissionless';
import { SafeSmartAccount } from 'permissionless/accounts/safe';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { AppConfigService } from '../config/app-config.service';
import { WalletNetworkError } from '../common/exceptions';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);
  private readonly publicClient;
  private readonly serverAccount: PrivateKeyAccount;
  private readonly pimlicoRpcUrl: string;

  constructor(private readonly appConfigService: AppConfigService) {
    this.publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(this.appConfigService.baseSepoliaRpcUrl),
    });
    this.serverAccount = privateKeyToAccount(this.appConfigService.serverEoaPrivateKey);
    this.pimlicoRpcUrl = `https://api.pimlico.io/v2/${baseSepolia.id}/rpc?apikey=${this.appConfigService.pimlicoApiKey}`;
  }

  async deriveAddress(telegramId: bigint): Promise<Hex> {
    const account = await this.createSmartAccount(telegramId);
    return getAddress(account.address);
  }

  async getUsdcBalance(address: Hex): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.appConfigService.usdcAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
    });
  }

  formatUsdc(amountBaseUnits: bigint): string {
    return formatUnits(amountBaseUnits, 6);
  }

  parseUsdc(amount: string): bigint {
    return parseUnits(amount, 6);
  }

  async sendUsdc(telegramId: bigint, recipientAddress: Hex, amountBaseUnits: bigint): Promise<Hex> {
    return this.withSingleRetry(async () => {
      const smartAccountClient = await this.createSmartAccountClient(telegramId);

      return smartAccountClient.sendTransaction({
        to: this.appConfigService.usdcAddress,
        value: 0n,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'transfer',
          args: [recipientAddress, amountBaseUnits],
        }),
      });
    });
  }

  async waitForUsdcTransfer(telegramId: bigint, hash: Hex): Promise<void> {
    await this.createSmartAccount(telegramId);
    await this.publicClient.waitForTransactionReceipt({ hash });
  }

  private async createSmartAccount(telegramId: bigint): Promise<SmartAccount> {
    return SafeSmartAccount.toSafeSmartAccount({
      client: this.publicClient,
      owners: [this.serverAccount],
      threshold: 1n,
      version: '1.4.1',
      entryPoint: {
        address: entryPoint07Address,
        version: '0.7',
      },
      saltNonce: telegramId,
    });
  }

  private async createSmartAccountClient(telegramId: bigint) {
    const account = await this.createSmartAccount(telegramId);
    const pimlicoClient = createPimlicoClient({
      chain: baseSepolia,
      transport: http(this.pimlicoRpcUrl),
      entryPoint: {
        address: entryPoint07Address,
        version: '0.7',
      },
    });

    return createSmartAccountClient({
      account,
      chain: baseSepolia,
      client: this.publicClient,
      bundlerTransport: http(this.pimlicoRpcUrl),
      userOperation: {
        estimateFeesPerGas: async () => {
          return (await pimlicoClient.getUserOperationGasPrice()).fast;
        },
      },
    });
  }

  private async withSingleRetry<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (firstError) {
      this.logger.warn({ err: firstError }, 'Wallet operation failed; retrying once');
      await new Promise((resolve) => setTimeout(resolve, 2_000));

      try {
        return await operation();
      } catch (secondError) {
        this.logger.error({ err: secondError }, 'Wallet operation failed after retry');
        throw new WalletNetworkError('Network busy');
      }
    }
  }
}
