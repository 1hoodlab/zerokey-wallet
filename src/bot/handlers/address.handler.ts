import { InputFile, type Context } from 'grammy';
import QRCode from 'qrcode';
import type { AccountService } from '../../account/account.service';
import { getTelegramId } from './context';

export async function handleAddress(
  ctx: Context,
  accountService: Pick<AccountService, 'getCurrentAccount'>,
): Promise<void> {
  const telegramId = getTelegramId(ctx);
  if (!telegramId) {
    await ctx.reply('Unable to identify your Telegram account.');
    return;
  }

  const account = await accountService.getCurrentAccount(telegramId);
  const qrPng = await QRCode.toBuffer(account.address);
  await ctx.replyWithPhoto(new InputFile(qrPng, 'zerokey-address.png'), {
    caption: `${account.network.displayName} (${account.network.chainId})\n${account.address}`,
  });
}
