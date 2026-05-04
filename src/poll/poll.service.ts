import { StandardMerkleTree } from '@openzeppelin/merkle-tree';

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PollSide } from '@prisma/client';
import {
  PollPayoutStatus,
  PollState,
  Prisma,
  VoteIntentStatus,
} from '@prisma/client';
import { encodeFunctionData, getAddress, keccak256, stringToBytes, type Hex } from 'viem';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';
import { NetworkRegistryService } from '../network/network-registry.service';
import { WalletService } from '../wallet/wallet.service';
import {
  allocateBinaryParimutuel,
  parimutuelDustRemainder,
} from './allocate-binary-parimutuel';
import { merklePayoutEscrowAbi } from './merkle-payout-escrow.abi';
import { PollMerkleCommitService } from './poll-merkle-commit.service';

const merkleLeafTypeTuple = ['bytes32', 'address', 'uint256', 'address'] as const;

@Injectable()
export class PollService {
  private readonly logger = new Logger(PollService.name);

  constructor(
    @Inject(PrismaService) private readonly prismaService: PrismaService,
    @Inject(WalletService) private readonly walletService: WalletService,
    @Inject(NetworkRegistryService) private readonly networkRegistryService: NetworkRegistryService,
    @Inject(AppConfigService) private readonly appConfigService: AppConfigService,
    @Inject(PollMerkleCommitService) private readonly pollMerkleCommitService: PollMerkleCommitService,
  ) {}

  async createPollEntry(parameters: {
    creatorTelegramId: bigint;
    networkIdReference: string;
    title: string;
    sideLabelA: string;
    sideLabelB: string;
  }): Promise<{ pollId: string }> {
    const createdPollRecord = await this.prismaService.poll.create({
      data: {
        creatorTelegramId: parameters.creatorTelegramId,
        networkId: parameters.networkIdReference,
        title: parameters.title,
        sideALabel: parameters.sideLabelA,
        sideBLabel: parameters.sideLabelB,
        state: PollState.OPEN,
      },
    });

    return { pollId: createdPollRecord.id };
  }

  async linkPollToTelegramNativePoll(parameters: {
    pollId: string;
    telegramPollId: string;
  }): Promise<void> {
    const updateOutcome = await this.prismaService.poll.updateMany({
      where: {
        id: parameters.pollId,
        state: PollState.OPEN,
        telegramPollId: null,
      },
      data: { telegramPollId: parameters.telegramPollId },
    });

    if (updateOutcome.count === 0) {
      throw new Error('Poll cannot be linked to Telegram (not found, not open, or already linked).');
    }
  }

  async lookupOpenPollStakeContextByTelegramPollId(
    telegramPollId: string,
  ): Promise<{ pollId: string; networkId: string } | null> {
    const pollRow = await this.prismaService.poll.findUnique({
      where: { telegramPollId },
      select: {
        id: true,
        networkId: true,
        state: true,
      },
    });

    if (!pollRow || pollRow.state !== PollState.OPEN) {
      return null;
    }

    return {
      pollId: pollRow.id,
      networkId: pollRow.networkId,
    };
  }

  async summarizePollForTelegram(pollId: string): Promise<string> {
    const pollSnapshot = await this.prismaService.poll.findUnique({
      where: { id: pollId },
      include: { network: true },
    });

    if (!pollSnapshot) {
      throw new Error('Poll not found.');
    }

    const sideAString = await this.sumStakeMatchingCutoff({
      pollId,
      outcome: 'SIDE_A',
      cutoffClosedAt: pollSnapshot.closedAt,
    });

    const sideBString = await this.sumStakeMatchingCutoff({
      pollId,
      outcome: 'SIDE_B',
      cutoffClosedAt: pollSnapshot.closedAt,
    });

    return [
      `Poll <code>${pollId}</code>`,
      `Network: ${pollSnapshot.network.displayName} (${pollSnapshot.network.slug})`,
      `State: ${pollSnapshot.state}`,
      `A (${pollEscape(pollSnapshot.sideALabel)}): ${sideAString} base units`,
      `B (${pollEscape(pollSnapshot.sideBLabel)}): ${sideBString} base units`,
    ].join('\n');
  }

  private async sumStakeMatchingCutoff(parameters: {
    pollId: string;
    outcome: PollSide;
    cutoffClosedAt: Date | null;
  }): Promise<string> {
    const rows = await this.prismaService.voteIntent.findMany({
      where: {
        pollId: parameters.pollId,
        outcome: parameters.outcome,
        status: VoteIntentStatus.STAKE_CONFIRMED,
        ...(parameters.cutoffClosedAt
          ? { stakeConfirmedAt: { lte: parameters.cutoffClosedAt } }
          : {}),
      },
      select: { amountBaseUnits: true },
    });

    let sum = 0n;
    for (const row of rows) {
      sum += BigInt(row.amountBaseUnits);
    }
    return sum.toString();
  }

  async closePollForCreator(parameters: { pollId: string; creatorTelegramId: bigint }): Promise<void> {
    const poll = await this.prismaService.poll.findUnique({ where: { id: parameters.pollId } });

    if (!poll) {
      throw new Error('Poll not found.');
    }
    if (poll.creatorTelegramId !== parameters.creatorTelegramId) {
      throw new Error('Only the poll creator can close this poll.');
    }
    if (poll.state !== PollState.OPEN) {
      throw new Error('Poll is not open.');
    }

    await this.prismaService.$transaction([
      this.prismaService.poll.update({
        where: { id: parameters.pollId },
        data: { state: PollState.CLOSED, closedAt: new Date() },
      }),
      this.prismaService.voteIntent.updateMany({
        where: { pollId: parameters.pollId, status: VoteIntentStatus.DRAFT },
        data: { status: VoteIntentStatus.BLOCKED_CLOSED },
      }),
    ]);
  }

  async resolvePollWithMerkleSettlement(parameters: {
    pollId: string;
    creatorTelegramId: bigint;
    winningSide: PollSide;
  }): Promise<void> {
    const poll = await this.prismaService.poll.findUnique({ where: { id: parameters.pollId } });

    if (!poll) {
      throw new Error('Poll not found.');
    }
    if (poll.creatorTelegramId !== parameters.creatorTelegramId) {
      throw new Error('Only the creator can resolve.');
    }
    if (poll.state !== PollState.CLOSED || !poll.closedAt) {
      throw new Error('Poll must be closed before resolving.');
    }

    const networkRecord = await this.networkRegistryService.findByIdOrThrow(poll.networkId);

    const eligible = await this.prismaService.voteIntent.findMany({
      where: {
        pollId: parameters.pollId,
        status: VoteIntentStatus.STAKE_CONFIRMED,
        stakeConfirmedAt: { not: null, lte: poll.closedAt },
      },
    });

    let totalWinners = 0n;
    let totalLosers = 0n;
    const winnersByParticipant = new Map<bigint, bigint>();

    for (const row of eligible) {
      const amt = BigInt(row.amountBaseUnits);
      if (row.outcome === parameters.winningSide) {
        totalWinners += amt;
        winnersByParticipant.set(row.telegramId, (winnersByParticipant.get(row.telegramId) ?? 0n) + amt);
      } else {
        totalLosers += amt;
      }
    }

    if (totalWinners === 0n) {
      const winningLetter = parameters.winningSide === 'SIDE_A' ? 'A' : 'B';
      const losingLetter = parameters.winningSide === 'SIDE_A' ? 'B' : 'A';
      if (eligible.length === 0) {
        throw new Error(
          [
            `No confirmed USDC stakes for this poll (neither side ${winningLetter} nor ${losingLetter}).`,
            'The Telegram poll counter is not used: you must reply YES after voting, complete the 6-digit OTP, and have the transfer confirm on-chain before /close_poll.',
            'Run /poll to see escrow stake totals per side.',
          ].join(' '),
        );
      }
      throw new Error(
        [
          `No stakes on winning side ${winningLetter} (${eligible.length} confirmed stake(s) are all on side ${losingLetter}).`,
          'Use /poll to verify which side has escrow, or call /resolve_poll with the other letter (A = first poll option, B = second).',
        ].join(' '),
      );
    }

    const payoutsMap = allocateBinaryParimutuel({
      totalStakeWinning: totalWinners,
      totalStakeLosing: totalLosers,
      winnerStakeByTelegramId: winnersByParticipant,
    });

    const dust = parimutuelDustRemainder({
      totalStakeWinning: totalWinners,
      totalStakeLosing: totalLosers,
      payouts: payoutsMap,
    });

    if (dust > 0n) {
      this.logger.log({ pollId: parameters.pollId, dust: dust.toString() }, 'Parimutuel dust');
    }

    const payoutIdHex = keccak256(
      stringToBytes(`${poll.id}:${poll.closedAt.toISOString()}`),
    ) as Hex;

    const tokenAddress = getAddress(networkRecord.usdcAddress);

    const leafRowsForTree: Array<[Hex, Hex, bigint, Hex]> = [];
    for (const [telegramParticipant, prizeBaseUnits] of payoutsMap.entries()) {
      const recipient = await this.walletService.deriveAddress(telegramParticipant, networkRecord);
      leafRowsForTree.push([
        payoutIdHex,
        recipient,
        prizeBaseUnits,
        tokenAddress,
      ]);
    }

    const tree = StandardMerkleTree.of(
      [...leafRowsForTree],
      [...merkleLeafTypeTuple],
    );

    const merkleRoot = tree.root as Hex;

    await this.prismaService.$transaction(async (tx) => {
      await tx.pollWinnerPayout.deleteMany({ where: { pollId: parameters.pollId } });

      for (const [participantTelegramIdentifier, owesBaseUnits] of payoutsMap.entries()) {
        const recipientAddressHex = await this.walletService.deriveAddress(
          participantTelegramIdentifier,
          networkRecord,
        );

        const proofVector = tree.getProof([
          payoutIdHex,
          recipientAddressHex,
          owesBaseUnits,
          tokenAddress,
        ]);

        await tx.pollWinnerPayout.create({
          data: {
            pollId: parameters.pollId,
            telegramId: participantTelegramIdentifier,
            amountOwedBaseUnits: owesBaseUnits.toString(),
            merkleProofTokens: [...proofVector] as unknown as Prisma.InputJsonValue,
            status: PollPayoutStatus.UNCLAIMED,
          },
        });
      }

      await tx.poll.update({
        where: { id: parameters.pollId },
        data: {
          state: PollState.RESOLVED,
          resolvedAt: new Date(),
          winningOutcome: parameters.winningSide,
          payoutIdHex,
          merkleRootHex: merkleRoot,
        },
      });
    });

    const commitTx = await this.pollMerkleCommitService.broadcastCommitRootTransaction({
      network: networkRecord,
      payoutId: payoutIdHex,
      merkleRoot,
    });

    if (commitTx) {
      await this.prismaService.poll.update({
        where: { id: parameters.pollId },
        data: { payoutCommittedAt: new Date(), payoutCommitTxHash: commitTx },
      });
    }
  }

  async submitMerkleClaimForParticipant(parameters: {
    pollId: string;
    telegramParticipantId: bigint;
  }): Promise<Hex> {
    const pollHydratedEnvelope = await this.prismaService.poll.findUnique({
      where: { id: parameters.pollId },
    });

    if (!pollHydratedEnvelope || pollHydratedEnvelope.state !== PollState.RESOLVED) {
      throw new Error('Poll not resolved.');
    }

    if (!pollHydratedEnvelope.payoutIdHex) {
      throw new Error('Payout identifiers missing.');
    }

    const row = await this.prismaService.pollWinnerPayout.findUnique({
      where: {
        pollId_telegramId: {
          pollId: parameters.pollId,
          telegramId: parameters.telegramParticipantId,
        },
      },
    });

    if (!row || row.status !== PollPayoutStatus.UNCLAIMED) {
      throw new Error('Nothing to claim.');
    }

    const networkResolved = await this.networkRegistryService.findByIdOrThrow(
      pollHydratedEnvelope.networkId,
    );

    const proofAsHex = row.merkleProofTokens as unknown as Hex[];

    const callData = encodeFunctionData({
      abi: merklePayoutEscrowAbi,
      functionName: 'claim',
      args: [
        pollHydratedEnvelope.payoutIdHex as Hex,
        getAddress(networkResolved.usdcAddress),
        BigInt(row.amountOwedBaseUnits),
        proofAsHex,
      ],
    });

    const hash = await this.walletService.executeContractCall(
      parameters.telegramParticipantId,
      networkResolved,
      {
        contractAddress: this.appConfigService.pollEscrowContractAddress(),
        encodedCallData: callData,
      },
    );

    await this.prismaService.pollWinnerPayout.update({
      where: { id: row.id },
      data: { status: PollPayoutStatus.PAID, outboundTxHash: hash },
    });

    return hash;
  }
}

function pollEscape(label: string): string {
  return label.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}
