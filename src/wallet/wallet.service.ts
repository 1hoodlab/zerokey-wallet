import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
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
import { bscTestnet } from 'viem/chains';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { entryPoint07Address, type SmartAccount } from 'viem/account-abstraction';
import { createSmartAccountClient } from 'permissionless';
import { SafeSmartAccount } from 'permissionless/accounts/safe';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { AppConfigService } from '../config/app-config.service';
import { WalletNetworkError } from '../common/exceptions';

@Injectable()
export class WalletService implements OnModuleInit {
  private readonly logger = new Logger(WalletService.name);
  private readonly publicClient;
  private readonly serverAccount: PrivateKeyAccount;
  private readonly pimlicoRpcUrl: string;
  private usdcDecimals = 6;

  constructor(
    @Inject(AppConfigService)
    private readonly appConfigService: AppConfigService,
  ) {
    this.publicClient = createPublicClient({
      chain: bscTestnet,
      transport: http(this.appConfigService.bscTestnetRpcUrl),
    });
    this.serverAccount = privateKeyToAccount(this.appConfigService.serverEoaPrivateKey);
    this.pimlicoRpcUrl = `https://api.pimlico.io/v2/${bscTestnet.id}/rpc?apikey=${this.appConfigService.pimlicoApiKey}`;
  }

  async onModuleInit(): Promise<void> {
    try {
      const decimalsRead = await this.publicClient.readContract({
        address: this.appConfigService.usdcAddress,
        abi: erc20Abi,
        functionName: 'decimals',
      });
      this.usdcDecimals = Number(decimalsRead);
    } catch (error) {
      this.logger.warn({ err: error }, 'Could not read token decimals from chain; using 6');
      this.usdcDecimals = 6;
    }
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
    const formattedUnits = formatUnits(amountBaseUnits, this.usdcDecimals);
    return WalletService.formatBalanceForDisplay(formattedUnits);
  }

  parseUsdc(amount: string): bigint {
    return parseUnits(amount, this.usdcDecimals);
  }

  private static formatBalanceForDisplay(formattedUnits: string): string {
    const trimmedInput = formattedUnits.trim();
    const isNegative = trimmedInput.startsWith('-');
    const unsigned = isNegative ? trimmedInput.slice(1) : trimmedInput;
    const [wholeRaw, fractionRaw = ''] = unsigned.split('.');
    const wholeNormalized = wholeRaw.replace(/^0+(?=\d)/, '') || '0';
    const groupedWhole = BigInt(wholeNormalized).toLocaleString('en-US');
    const trimmedFraction = fractionRaw.replace(/0+$/, '');
    const combined =
      trimmedFraction.length > 0 ? `${groupedWhole}.${trimmedFraction}` : groupedWhole;
    return isNegative ? `-${combined}` : combined;
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
      chain: bscTestnet,
      transport: http(this.pimlicoRpcUrl),
      entryPoint: {
        address: entryPoint07Address,
        version: '0.7',
      },
    });

    return createSmartAccountClient({
      account,
      chain: bscTestnet,
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
