import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Network } from '@prisma/client';
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  parseUnits,
  type Chain,
  type Hex,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { entryPoint07Address, type SmartAccount } from 'viem/account-abstraction';
import { createSmartAccountClient } from 'permissionless';
import { SafeSmartAccount } from 'permissionless/accounts/safe';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { WalletNetworkError } from '../common/exceptions';
import { AppConfigService } from '../config/app-config.service';
import { NetworkRegistryService } from '../network/network-registry.service';

interface NetworkClients {
  chain: Chain;
  pimlicoRpcUrl: string;
  publicClient: PublicClient;
}

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);
  private readonly networkClientCache = new Map<number, NetworkClients>();
  private readonly serverAccount: PrivateKeyAccount;
  private readonly usdcDecimalsCache = new Map<string, number>();

  constructor(
    @Inject(AppConfigService)
    private readonly appConfigService: AppConfigService,
    @Inject(NetworkRegistryService)
    private readonly networkRegistryService: NetworkRegistryService,
  ) {
    this.serverAccount = privateKeyToAccount(this.appConfigService.serverEoaPrivateKey);
  }

  async deriveAddress(telegramId: bigint, network: Network): Promise<Hex> {
    const account = await this.createSmartAccount(telegramId, network);
    return getAddress(account.address);
  }

  async getUsdcBalance(address: Hex, network: Network): Promise<bigint> {
    const clients = this.getOrCreateNetworkClients(network);
    return clients.publicClient.readContract({
      address: getAddress(network.usdcAddress),
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
    });
  }

  async formatUsdc(amountBaseUnits: bigint, network: Network): Promise<string> {
    const decimals = await this.getUsdcDecimals(network);
    const formattedUnits = formatUnits(amountBaseUnits, decimals);
    return WalletService.formatBalanceForDisplay(formattedUnits);
  }

  async parseUsdc(amount: string, network: Network): Promise<bigint> {
    const decimals = await this.getUsdcDecimals(network);
    return parseUnits(amount, decimals);
  }

  async getUsdcDecimals(network: Network): Promise<number> {
    const cachedDecimals = this.usdcDecimalsCache.get(network.id);
    if (cachedDecimals !== undefined) {
      return cachedDecimals;
    }

    try {
      const clients = this.getOrCreateNetworkClients(network);
      const decimalsRead = await clients.publicClient.readContract({
        address: getAddress(network.usdcAddress),
        abi: erc20Abi,
        functionName: 'decimals',
      });
      const numericDecimals = Number(decimalsRead);
      this.usdcDecimalsCache.set(network.id, numericDecimals);
      return numericDecimals;
    } catch (error) {
      this.logger.warn(
        { err: error, networkSlug: network.slug },
        'Could not read token decimals from chain; using 6',
      );
      this.usdcDecimalsCache.set(network.id, 6);
      return 6;
    }
  }

  async sendUsdc(
    telegramId: bigint,
    network: Network,
    recipientAddress: Hex,
    amountBaseUnits: bigint,
  ): Promise<Hex> {
    return this.withSingleRetry(async () => {
      const smartAccountClient = await this.createSmartAccountClient(telegramId, network);

      return smartAccountClient.sendTransaction({
        to: getAddress(network.usdcAddress),
        value: 0n,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'transfer',
          args: [recipientAddress, amountBaseUnits],
        }),
      });
    });
  }

  async waitForUsdcTransfer(network: Network, hash: Hex): Promise<void> {
    const clients = this.getOrCreateNetworkClients(network);
    await clients.publicClient.waitForTransactionReceipt({ hash });
  }

  private getOrCreateNetworkClients(network: Network): NetworkClients {
    const cachedClients = this.networkClientCache.get(network.chainId);
    if (cachedClients) {
      return cachedClients;
    }

    const chain = this.networkRegistryService.toViemChain(network);
    const publicClient = createPublicClient({
      chain,
      transport: http(network.rpcUrl),
    });
    const pimlicoRpcUrl = `https://api.pimlico.io/v2/${network.chainId}/rpc?apikey=${this.appConfigService.pimlicoApiKey}`;
    const clients: NetworkClients = { chain, pimlicoRpcUrl, publicClient };
    this.networkClientCache.set(network.chainId, clients);
    return clients;
  }

  private async createSmartAccount(telegramId: bigint, network: Network): Promise<SmartAccount> {
    const clients = this.getOrCreateNetworkClients(network);
    return SafeSmartAccount.toSafeSmartAccount({
      client: clients.publicClient,
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

  private async createSmartAccountClient(telegramId: bigint, network: Network) {
    const clients = this.getOrCreateNetworkClients(network);
    const account = await this.createSmartAccount(telegramId, network);
    const pimlicoClient = createPimlicoClient({
      chain: clients.chain,
      transport: http(clients.pimlicoRpcUrl),
      entryPoint: {
        address: entryPoint07Address,
        version: '0.7',
      },
    });

    return createSmartAccountClient({
      account,
      chain: clients.chain,
      client: clients.publicClient,
      bundlerTransport: http(clients.pimlicoRpcUrl),
      userOperation: {
        estimateFeesPerGas: async () => {
          return (await pimlicoClient.getUserOperationGasPrice()).fast;
        },
      },
    });
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
