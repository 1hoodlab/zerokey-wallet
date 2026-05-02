import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TransferStatus } from '@prisma/client';
import type { Hex } from 'viem';
import { NoPendingTransferError, OtpExpiredError, OtpInvalidError } from '../common/exceptions';
import { TRANSFER_CONFIRMED_EVENT, TRANSFER_FAILED_EVENT } from '../common/events';
import { PrismaService } from '../database/prisma.service';
import { OtpService } from '../otp/otp.service';
import { WalletService } from '../wallet/wallet.service';

export interface InitiatedTransfer {
  transferId: string;
  code: string;
}

export interface SubmittedTransfer {
  hash: Hex;
}

@Injectable()
export class TransferService {
  private readonly logger = new Logger(TransferService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly otpService: OtpService,
    private readonly walletService: WalletService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async initiate(
    telegramId: bigint,
    recipientAddress: Hex,
    amountBaseUnits: bigint,
  ): Promise<InitiatedTransfer> {
    await this.prismaService.pendingTransfer.updateMany({
      where: { telegramId, status: TransferStatus.AWAITING_OTP },
      data: { status: TransferStatus.CANCELLED },
    });

    const code = this.otpService.generateCode();
    const pendingTransfer = await this.prismaService.pendingTransfer.create({
      data: {
        telegramId,
        recipient: recipientAddress,
        amount: amountBaseUnits.toString(),
        otpHash: this.otpService.hashCode(code),
        status: TransferStatus.AWAITING_OTP,
      },
    });

    return { transferId: pendingTransfer.id, code };
  }

  async confirm(telegramId: bigint, code: string): Promise<SubmittedTransfer> {
    const pendingTransfer = await this.prismaService.pendingTransfer.findFirst({
      where: { telegramId, status: TransferStatus.AWAITING_OTP },
      orderBy: { createdAt: 'desc' },
    });

    if (!pendingTransfer) {
      throw new NoPendingTransferError();
    }

    if (this.otpService.isExpired(pendingTransfer.createdAt)) {
      await this.prismaService.pendingTransfer.update({
        where: { id: pendingTransfer.id },
        data: { status: TransferStatus.EXPIRED },
      });
      throw new OtpExpiredError();
    }

    if (!this.otpService.verifyHash(code, pendingTransfer.otpHash)) {
      const retryCountAfterFailure = pendingTransfer.retryCount + 1;
      const retriesLeft = this.otpService.getRetriesLeft(retryCountAfterFailure);
      await this.prismaService.pendingTransfer.update({
        where: { id: pendingTransfer.id },
        data:
          retriesLeft === 0
            ? { retryCount: retryCountAfterFailure, status: TransferStatus.CANCELLED }
            : { retryCount: retryCountAfterFailure },
      });
      throw new OtpInvalidError(retriesLeft);
    }

    const claimedTransfer = await this.prismaService.pendingTransfer.updateMany({
      where: { id: pendingTransfer.id, status: TransferStatus.AWAITING_OTP },
      data: { status: TransferStatus.BROADCASTING },
    });
    if (claimedTransfer.count !== 1) {
      throw new NoPendingTransferError();
    }

    try {
      const txHash = await this.walletService.sendUsdc(
        telegramId,
        pendingTransfer.recipient as Hex,
        BigInt(pendingTransfer.amount),
      );
      await this.prismaService.pendingTransfer.update({
        where: { id: pendingTransfer.id },
        data: { status: TransferStatus.SUBMITTED, txHash, confirmedAt: new Date() },
      });
      void this.pollReceipt(pendingTransfer.id, txHash).catch((error: unknown) => {
        this.logger.error({ err: error }, 'Receipt polling failed');
      });
      return { hash: txHash };
    } catch (error) {
      await this.prismaService.pendingTransfer.update({
        where: { id: pendingTransfer.id },
        data: { status: TransferStatus.FAILED },
      });
      throw error;
    }
  }

  async pollReceipt(transferId: string, hash: Hex): Promise<void> {
    const transferToPoll = await this.prismaService.pendingTransfer.findFirst({
      where: { id: transferId },
    });
    if (!transferToPoll) {
      throw new NoPendingTransferError();
    }

    try {
      await this.waitForReceiptWithTimeout(transferToPoll.telegramId, hash);
    } catch (error) {
      const status =
        error instanceof ReceiptTimeoutError ? TransferStatus.TIMEOUT : TransferStatus.FAILED;
      const transfer = await this.prismaService.pendingTransfer.update({
        where: { id: transferId },
        data: { status },
      });
      this.eventEmitter.emit(TRANSFER_FAILED_EVENT, {
        chatId: transfer.telegramId,
        hash,
        reason: error instanceof Error ? error.message : 'Receipt polling failed',
      });
      return;
    }

    const transfer = await this.prismaService.pendingTransfer.update({
      where: { id: transferId },
      data: { status: TransferStatus.CONFIRMED },
    });

    this.eventEmitter.emit(TRANSFER_CONFIRMED_EVENT, {
      chatId: transfer.telegramId,
      hash,
    });
  }

  async markReceiptFailed(transferId: string, hash: Hex, reason: string): Promise<void> {
    const transfer = await this.prismaService.pendingTransfer.update({
      where: { id: transferId },
      data: { status: TransferStatus.FAILED },
    });

    this.eventEmitter.emit(TRANSFER_FAILED_EVENT, {
      chatId: transfer.telegramId,
      hash,
      reason,
    });
  }

  private async waitForReceiptWithTimeout(telegramId: bigint, hash: Hex): Promise<void> {
    let timeoutId: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.walletService.waitForUsdcTransfer(telegramId, hash),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new ReceiptTimeoutError()), 60_000);
        }),
      ]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }
}

class ReceiptTimeoutError extends Error {
  constructor() {
    super('Receipt polling timed out');
  }
}
