import type { Context } from 'grammy';
import type { AccountService } from '../../account/account.service';
import type { WalletService } from '../../wallet/wallet.service';
import { getTelegramId } from './context';

export async function handleBalance(
  ctx: Context,
  accountService: Pick<AccountService, 'getOrCreate'>,
  walletService: Pick<WalletService, 'getUsdcBalance' | 'formatUsdc'>,
): Promise<void> {
  const telegramId = getTelegramId(ctx);
  if (!telegramId) {
    await ctx.reply('Unable to identify your Telegram account.');
    return;
  }

  const account = await accountService.getOrCreate(telegramId);
  const balance = await walletService.getUsdcBalance(account.address);
  await ctx.reply(`USDC balance: ${walletService.formatUsdc(balance)}`);
}
