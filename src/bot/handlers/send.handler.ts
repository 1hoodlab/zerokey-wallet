import type { Context } from 'grammy';
import { getAddress, isAddress, zeroAddress, type Hex } from 'viem';
import type { AccountService } from '../../account/account.service';
import type { TransferService } from '../../transfer/transfer.service';
import type { WalletService } from '../../wallet/wallet.service';
import { getMessageText, getTelegramId } from './context';

function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function handleSend(
  ctx: Context,
  accountService: Pick<AccountService, 'getOrCreate'>,
  walletService: Pick<WalletService, 'getUsdcBalance' | 'parseUsdc' | 'formatUsdc'>,
  transferService: Pick<TransferService, 'initiate'>,
): Promise<void> {
  const telegramId = getTelegramId(ctx);
  if (!telegramId) {
    await ctx.reply('Unable to identify your Telegram account.');
    return;
  }

  const sendCommandParts = getMessageText(ctx).trim().split(/\s+/);
  if (sendCommandParts.length !== 3) {
    await ctx.reply('Usage: /send <amount> <0x-address>');
    return;
  }
  const [, amountText, recipientText] = sendCommandParts;

  if (!isAddress(recipientText)) {
    await ctx.reply('Invalid Ethereum address.');
    return;
  }

  const account = await accountService.getOrCreate(telegramId);
  const recipientAddress = getAddress(recipientText);
  if (recipientAddress === zeroAddress || recipientAddress === getAddress(account.address)) {
    await ctx.reply('Recipient address is not allowed.');
    return;
  }

  let amountBaseUnits: bigint;
  try {
    amountBaseUnits = walletService.parseUsdc(amountText);
  } catch {
    await ctx.reply('Invalid USDC amount.');
    return;
  }

  if (amountBaseUnits <= 0n) {
    await ctx.reply('Amount must be greater than zero.');
    return;
  }

  const balance = await walletService.getUsdcBalance(account.address);
  if (balance < amountBaseUnits) {
    await ctx.reply('Insufficient USDC balance.');
    return;
  }

  const transfer = await transferService.initiate(
    telegramId,
    recipientAddress as Hex,
    amountBaseUnits,
  );
  const amountFormatted = escapeTelegramHtml(walletService.formatUsdc(amountBaseUnits));
  const recipientEscaped = escapeTelegramHtml(recipientAddress);

  await ctx.reply(
    [
      `Confirm send of ${amountFormatted} USDC.`,
      `Recipient: ${recipientEscaped}`,
      `OTP: <tg-spoiler>${escapeTelegramHtml(transfer.code)}</tg-spoiler>`,
      'Reply with the 6-digit OTP within 5 minutes.',
    ].join('\n'),
    { parse_mode: 'HTML' },
  );
}
