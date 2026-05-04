import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { PollSide } from '@prisma/client';
import { PollState, VoteIntentStatus } from '@prisma/client';
import type { Hex } from 'viem';
import { AccountService } from '../account/account.service';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';
import { TransferService } from '../transfer/transfer.service';
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class VoteIntentService {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(AccountService)
    private readonly accountService: AccountService,
    @Inject(TransferService)
    private readonly transferService: TransferService,
    @Inject(WalletService)
    private readonly walletService: WalletService,
    @Inject(AppConfigService)
    private readonly appConfigService: AppConfigService,
  ) {}

  async beginDraftVoteIntent(parameters: {
    pollId: string;
    telegramUserId: bigint;
    chosenOutcome: PollSide;
    stakeAmountBaseUnits: bigint;
  }): Promise<{ voteIntentId: string }> {
    const pollRecord = await this.prismaService.poll.findUnique({
      where: { id: parameters.pollId },
    });

    if (!pollRecord) {
      throw new Error('Poll not found.');
    }

    if (pollRecord.state !== PollState.OPEN) {
      throw new Error('This poll is not accepting votes.');
    }

    const existingConfirmedStake = await this.prismaService.voteIntent.findFirst({
      where: {
        pollId: pollRecord.id,
        telegramId: parameters.telegramUserId,
        status: VoteIntentStatus.STAKE_CONFIRMED,
      },
      select: { id: true },
    });

    if (existingConfirmedStake) {
      throw new Error('You already completed an escrow stake for this poll.');
    }

    const expirationDeadline = new Date(Date.now() + this.appConfigService.otpTtlSeconds * 1000);

    const persistedIntent = await this.prismaService.voteIntent.create({
      data: {
        id: randomUUID(),
        pollId: pollRecord.id,
        telegramId: parameters.telegramUserId,
        outcome: parameters.chosenOutcome,
        amountBaseUnits: parameters.stakeAmountBaseUnits.toString(),
        status: VoteIntentStatus.DRAFT,
        expiresAt: expirationDeadline,
      },
    });

    return { voteIntentId: persistedIntent.id };
  }

  async confirmDraftAndBeginEscrowTransfer(parameters: {
    voteIntentId: string;
    telegramUserId: bigint;
  }): Promise<{ otpCodePlaintext: string; stakeAmountBaseUnits: bigint }> {
    const intentWithPoll = await this.prismaService.voteIntent.findUnique({
      where: { id: parameters.voteIntentId },
      include: { poll: true },
    });

    if (!intentWithPoll) {
      throw new Error('Vote intent not found.');
    }

    if (intentWithPoll.telegramId !== parameters.telegramUserId) {
      throw new Error('This vote intent belongs to another user.');
    }

    if (intentWithPoll.status !== VoteIntentStatus.DRAFT) {
      throw new Error('Vote intent cannot be confirmed in its current state.');
    }

    if (intentWithPoll.poll.state !== PollState.OPEN) {
      throw new Error('Poll is closed.');
    }

    if (intentWithPoll.expiresAt < new Date()) {
      await this.prismaService.voteIntent.update({
        where: { id: intentWithPoll.id },
        data: { status: VoteIntentStatus.EXPIRED },
      });
      throw new Error('Vote confirmation window expired.');
    }

    const currentAccount = await this.accountService.getCurrentAccount(parameters.telegramUserId);

    if (currentAccount.network.id !== intentWithPoll.poll.networkId) {
      throw new Error('Switch to the poll network (/switch) before voting.');
    }

    const escrowRecipient = this.appConfigService.pollEscrowContractAddress();
    const stakeBaseUnits = BigInt(intentWithPoll.amountBaseUnits);

    const walletBalanceBaseUnits = await this.walletService.getUsdcBalance(
      currentAccount.address,
      currentAccount.network,
    );

    if (walletBalanceBaseUnits < stakeBaseUnits) {
      throw new Error('Insufficient USDC balance.');
    }

    const initiatedStakeTransfer = await this.transferService.initiate(
      parameters.telegramUserId,
      currentAccount.network,
      escrowRecipient as Hex,
      stakeBaseUnits,
    );

    await this.prismaService.voteIntent.update({
      where: { id: intentWithPoll.id },
      data: {
        status: VoteIntentStatus.AWAITING_ESCROW_PAYMENT,
        pendingTransferId: initiatedStakeTransfer.transferId,
      },
    });

    return {
      otpCodePlaintext: initiatedStakeTransfer.code,
      stakeAmountBaseUnits: stakeBaseUnits,
    };
  }

  async locateLatestUnexpiredDraftIntent(telegramUserId: bigint): Promise<string | null> {
    const intentRecord = await this.prismaService.voteIntent.findFirst({
      where: {
        telegramId: telegramUserId,
        status: VoteIntentStatus.DRAFT,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    return intentRecord?.id ?? null;
  }
}
