import { Inject, Injectable } from '@nestjs/common';
import type { Network } from '@prisma/client';
import { defineChain, type Chain } from 'viem';
import { PrismaService } from '../database/prisma.service';

function nativeCurrencyForChain(chainId: number): {
  name: string;
  symbol: string;
  decimals: number;
} {
  if (chainId === 97) {
    return { name: 'BNB', symbol: 'tBNB', decimals: 18 };
  }

  return { name: 'Ether', symbol: 'ETH', decimals: 18 };
}

@Injectable()
export class NetworkRegistryService {
  private readonly chainCache = new Map<number, Chain>();

  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
  ) {}

  async findBySlug(slug: string): Promise<Network | null> {
    const normalizedSlug = slug.trim().toLowerCase();
    return this.prismaService.network.findFirst({
      where: { slug: normalizedSlug, enabled: true },
    });
  }

  async findByIdOrThrow(networkId: string): Promise<Network> {
    const network = await this.prismaService.network.findUnique({
      where: { id: networkId },
    });
    if (!network) {
      throw new Error(`Network ${networkId} not found`);
    }

    return network;
  }

  async listEnabled(): Promise<Network[]> {
    return this.prismaService.network.findMany({
      where: { enabled: true },
      orderBy: { displayName: 'asc' },
    });
  }

  toViemChain(network: Network): Chain {
    const cachedChain = this.chainCache.get(network.chainId);
    if (cachedChain) {
      return cachedChain;
    }

    const chain = defineChain({
      id: network.chainId,
      name: network.displayName,
      nativeCurrency: nativeCurrencyForChain(network.chainId),
      rpcUrls: {
        default: { http: [network.rpcUrl] },
      },
    });
    this.chainCache.set(network.chainId, chain);
    return chain;
  }
}
