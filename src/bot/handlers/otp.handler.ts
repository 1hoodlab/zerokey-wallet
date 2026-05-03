import type { Context } from 'grammy';
import {
  NoPendingTransferError,
  OtpExpiredError,
  OtpInvalidError,
  WalletNetworkError,
} from '../../common/exceptions';
import type { AccountService } from '../../account/account.service';
import type { TransferService } from '../../transfer/transfer.service';
import { getMessageText, getTelegramId } from './context';

export async function handleOtp(
  ctx: Context,
  accountService: Pick<AccountService, 'getOrCreate'>,
  transferService: Pick<TransferService, 'confirm'>,
): Promise<void> {
  const telegramId = getTelegramId(ctx);
  if (!telegramId) {
    await ctx.reply('Unable to identify your Telegram account.');
    return;
  }

  await accountService.getOrCreate(telegramId);

  try {
    const submittedTransfer = await transferService.confirm(
      telegramId,
      getMessageText(ctx).trim(),
      {
        afterOtpAccepted: async () => {
          await ctx.reply(
            'Submitting your transfer to the network. This may take a minute — hang tight.',
          );
        },
      },
    );
    await ctx.reply(`Transfer submitted: ${submittedTransfer.hash}`);
  } catch (error) {
    if (error instanceof OtpExpiredError) {
      await ctx.reply('OTP expired. Start a new /send.');
      return;
    }

    if (error instanceof OtpInvalidError) {
      await ctx.reply(`Invalid OTP. ${error.retriesLeft} retries left.`);
      return;
    }

    if (error instanceof NoPendingTransferError) {
      await ctx.reply('No pending transfer. Start with /send.');
      return;
    }

    if (error instanceof WalletNetworkError) {
      await ctx.reply('Network busy. Try again later.');
      return;
    }

    throw error;
  }
}
