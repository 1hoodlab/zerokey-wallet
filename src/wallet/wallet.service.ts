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
import { RhinestoneSDK, type RhinestoneAccount, type UserOperationResult } from '@rhinestone/sdk';
import { AppConfigService } from '../config/app-config.service';
import { WalletNetworkError } from '../common/exceptions';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);
  private readonly publicClient;
  private readonly rhinestone: RhinestoneSDK;
  private readonly serverAccount: PrivateKeyAccount;

  constructor(private readonly appConfigService: AppConfigService) {
    this.publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(this.appConfigService.baseSepoliaRpcUrl),
    });
    this.rhinestone = new RhinestoneSDK({
      apiKey: this.appConfigService.rhinestoneApiKey,
    });
    this.serverAccount = privateKeyToAccount(this.appConfigService.serverEoaPrivateKey);
  }

  async deriveAddress(telegramId: bigint): Promise<Hex> {
    const account = await this.createSmartAccount(telegramId);
    return getAddress(account.getAddress());
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
      const account = await this.createSmartAccount(telegramId);
      const transaction = await account.sendUserOperation({
        chain: baseSepolia,
        calls: [
          {
            to: this.appConfigService.usdcAddress,
            value: 0n,
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: 'transfer',
              args: [recipientAddress, amountBaseUnits],
            }),
          },
        ],
      });

      return transaction.hash;
    });
  }

  async waitForUsdcTransfer(telegramId: bigint, hash: Hex): Promise<void> {
    const account = await this.createSmartAccount(telegramId);
    const userOperationResult: UserOperationResult = {
      type: 'userop',
      hash,
      chain: baseSepolia.id,
    };
    await account.waitForExecution(userOperationResult);
  }

  private async createSmartAccount(telegramId: bigint): Promise<RhinestoneAccount> {
    return this.rhinestone.createAccount({
      owners: {
        type: 'ecdsa',
        accounts: [this.serverAccount],
        threshold: 1,
      },
      account: {
        type: 'safe',
        nonce: telegramId,
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
