import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Hex } from 'viem';
import { PrismaService } from '../database/prisma.service';
import { WalletService } from '../wallet/wallet.service';

export interface AccountResult {
  address: Hex;
  isNew: boolean;
}

@Injectable()
export class AccountService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly walletService: WalletService,
  ) {}

  async getOrCreate(telegramId: bigint): Promise<AccountResult> {
    const existingUser = await this.prismaService.user.findUnique({ where: { telegramId } });
    if (existingUser) {
      return { address: existingUser.address as Hex, isNew: false };
    }

    const address = await this.walletService.deriveAddress(telegramId);

    try {
      await this.prismaService.user.create({ data: { telegramId, address } });
      return { address, isNew: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const racedUser = await this.prismaService.user.findUniqueOrThrow({
          where: { telegramId },
        });
        return { address: racedUser.address as Hex, isNew: false };
      }

      throw error;
    }
  }
}
