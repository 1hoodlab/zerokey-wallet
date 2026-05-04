import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type Network } from '@prisma/client';
import type { Hex } from 'viem';
import { PrismaService } from '../database/prisma.service';
import { NetworkRegistryService } from '../network/network-registry.service';
import { WalletService } from '../wallet/wallet.service';

export interface AccountForNetwork {
  address: Hex;
  networkId: string;
  isNew: boolean;
}

export interface CurrentAccount {
  address: Hex;
  network: Network;
  isNew: boolean;
}

@Injectable()
export class AccountService {
  static readonly DEFAULT_NETWORK_SLUG = 'bsc_testnet';

  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(WalletService)
    private readonly walletService: WalletService,
    @Inject(NetworkRegistryService)
    private readonly networkRegistryService: NetworkRegistryService,
  ) {}

  async getOrCreateForNetwork(
    telegramId: bigint,
    network: Network,
  ): Promise<AccountForNetwork> {
    const existingAddress = await this.prismaService.userNetworkAddress.findUnique({
      where: { telegramId_networkId: { telegramId, networkId: network.id } },
    });
    if (existingAddress) {
      return { address: existingAddress.address as Hex, networkId: network.id, isNew: false };
    }

    await this.prismaService.user.upsert({
      where: { telegramId },
      update: {},
      create: { telegramId, selectedNetworkId: network.id },
    });

    const derivedAddress = await this.walletService.deriveAddress(telegramId, network);

    try {
      await this.prismaService.userNetworkAddress.create({
        data: { telegramId, networkId: network.id, address: derivedAddress },
      });
      return { address: derivedAddress, networkId: network.id, isNew: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const racedRow = await this.prismaService.userNetworkAddress.findUnique({
          where: { telegramId_networkId: { telegramId, networkId: network.id } },
        });
        if (racedRow) {
          return { address: racedRow.address as Hex, networkId: network.id, isNew: false };
        }
      }

      throw error;
    }
  }

  async getCurrentAccount(telegramId: bigint): Promise<CurrentAccount> {
    await this.ensureUserExistsWithDefaultNetwork(telegramId);
    const user = await this.prismaService.user.findUniqueOrThrow({
      where: { telegramId },
      include: { selectedNetwork: true },
    });

    return this.buildCurrentAccountForNetwork(telegramId, user.selectedNetwork);
  }

  async ensureUserOnDefaultNetwork(telegramId: bigint): Promise<CurrentAccount> {
    const existingUser = await this.prismaService.user.findUnique({
      where: { telegramId },
      include: { selectedNetwork: true },
    });
    if (existingUser) {
      return this.buildCurrentAccountForNetwork(telegramId, existingUser.selectedNetwork);
    }

    const defaultNetwork = await this.resolveDefaultNetwork();
    await this.prismaService.user.create({
      data: { telegramId, selectedNetworkId: defaultNetwork.id },
    });
    const accountForNetwork = await this.getOrCreateForNetwork(telegramId, defaultNetwork);
    return {
      address: accountForNetwork.address,
      network: defaultNetwork,
      isNew: true,
    };
  }

  async switchNetwork(telegramId: bigint, network: Network): Promise<CurrentAccount> {
    await this.prismaService.user.upsert({
      where: { telegramId },
      update: { selectedNetworkId: network.id },
      create: { telegramId, selectedNetworkId: network.id },
    });
    const accountForNetwork = await this.getOrCreateForNetwork(telegramId, network);
    return { address: accountForNetwork.address, network, isNew: accountForNetwork.isNew };
  }

  private async ensureUserExistsWithDefaultNetwork(telegramId: bigint): Promise<void> {
    const existingUser = await this.prismaService.user.findUnique({
      where: { telegramId },
    });
    if (existingUser) {
      return;
    }

    const defaultNetwork = await this.resolveDefaultNetwork();
    await this.prismaService.user.create({
      data: { telegramId, selectedNetworkId: defaultNetwork.id },
    });
  }

  private async buildCurrentAccountForNetwork(
    telegramId: bigint,
    network: Network,
  ): Promise<CurrentAccount> {
    const accountForNetwork = await this.getOrCreateForNetwork(telegramId, network);
    return {
      address: accountForNetwork.address,
      network,
      isNew: accountForNetwork.isNew,
    };
  }

  private async resolveDefaultNetwork(): Promise<Network> {
    const defaultNetwork = await this.networkRegistryService.findBySlug(
      AccountService.DEFAULT_NETWORK_SLUG,
    );
    if (!defaultNetwork) {
      throw new Error(
        `Default network ${AccountService.DEFAULT_NETWORK_SLUG} is missing or disabled; run prisma db seed`,
      );
    }

    return defaultNetwork;
  }
}
