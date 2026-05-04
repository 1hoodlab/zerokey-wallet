import { Inject, Injectable, Logger } from '@nestjs/common';
import { PollState, TransferStatus, VoteIntentStatus } from '@prisma/client';
import { getAddress, type Hex } from 'viem';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';

/**
 * Marks linked {@link VoteIntent}s when a poll-stake {@link PendingTransfer} reaches CONFIRMED.
 * Called from TransferService after receipt finalize so vote_intents cannot stay AWAITING_ESCROW_PAYMENT
 * when pending_transfers is already CONFIRMED (e.g. missed in-process event deliveries).
 */
@Injectable()
export class PollTransferStakeSyncService {
  private readonly logger = new Logger(PollTransferStakeSyncService.name);

  constructor(
    @Inject(PrismaService) private readonly prismaService: PrismaService,
    @Inject(AppConfigService) private readonly appConfigService: AppConfigService,
  ) {}

  async applyConfirmedStakeForTransferId(transferId: string): Promise<void> {
    const confirmedPendingRow = await this.prismaService.pendingTransfer.findUnique({
      where: { id: transferId },
    });

    if (!confirmedPendingRow || confirmedPendingRow.status !== TransferStatus.CONFIRMED) {
      return;
    }

    const linkedVoteIntentEnvelope = await this.prismaService.voteIntent.findUnique({
      where: { pendingTransferId: confirmedPendingRow.id },
      include: { poll: true },
    });

    if (!linkedVoteIntentEnvelope) {
      return;
    }

    if (linkedVoteIntentEnvelope.status !== VoteIntentStatus.AWAITING_ESCROW_PAYMENT) {
      return;
    }

    let nextIntentStatusApplied: VoteIntentStatus = VoteIntentStatus.STAKE_CONFIRMED;

    const escrowConfiguredAddressChecksum = getAddress(
      this.appConfigService.pollEscrowContractAddress() as Hex,
    );

    const recordedRecipientNormalizedAddress = getAddress(
      confirmedPendingRow.recipient as Hex,
    );

    const amountMatchesStakeIntentNumerically =
      BigInt(confirmedPendingRow.amount) === BigInt(linkedVoteIntentEnvelope.amountBaseUnits);

    const networkAgreementPredicate =
      confirmedPendingRow.networkId === linkedVoteIntentEnvelope.poll.networkId;

    const escrowDestinationMatchesConfiguredEnvironment =
      recordedRecipientNormalizedAddress === escrowConfiguredAddressChecksum;

    if (
      !(
        escrowDestinationMatchesConfiguredEnvironment &&
        networkAgreementPredicate &&
        amountMatchesStakeIntentNumerically
      )
    ) {
      nextIntentStatusApplied = VoteIntentStatus.FAILED;
      this.logger.warn(
        {
          pendingTransferRowId: confirmedPendingRow.id,
          voteIntentEnvelopeId: linkedVoteIntentEnvelope.id,
          configuredEscrow: escrowConfiguredAddressChecksum,
          transferRecipient: recordedRecipientNormalizedAddress,
        },
        'VoteIntent stake transfer mismatched escrow, network, or amount',
      );
    }

    if (linkedVoteIntentEnvelope.poll.state === PollState.RESOLVED) {
      nextIntentStatusApplied = VoteIntentStatus.FAILED;
    }

    const stakeConfirmationMoment = confirmedPendingRow.confirmedAt ?? new Date();

    if (
      linkedVoteIntentEnvelope.poll.closedAt !== null &&
      stakeConfirmationMoment > linkedVoteIntentEnvelope.poll.closedAt
    ) {
      nextIntentStatusApplied = VoteIntentStatus.FAILED;
    }

    await this.prismaService.voteIntent.update({
      where: { id: linkedVoteIntentEnvelope.id },
      data:
        nextIntentStatusApplied === VoteIntentStatus.STAKE_CONFIRMED
          ? {
              status: VoteIntentStatus.STAKE_CONFIRMED,
              stakeConfirmedAt: stakeConfirmationMoment,
            }
          : { status: VoteIntentStatus.FAILED },
    });

    if (nextIntentStatusApplied === VoteIntentStatus.STAKE_CONFIRMED) {
      this.logger.log(
        { voteIntentId: linkedVoteIntentEnvelope.id, pendingTransferId: transferId },
        'VoteIntent promoted to STAKE_CONFIRMED',
      );
    }
  }
}
