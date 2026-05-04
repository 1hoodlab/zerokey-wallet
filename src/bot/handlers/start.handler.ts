import type { Context } from 'grammy';
import type { AccountService } from '../../account/account.service';
import { getTelegramId } from './context';

export async function handleStart(
  ctx: Context,
  accountService: Pick<AccountService, 'ensureUserOnDefaultNetwork'>,
): Promise<void> {
  const telegramId = getTelegramId(ctx);
  if (!telegramId) {
    await ctx.reply('Unable to identify your Telegram account.');
    return;
  }

  const account = await accountService.ensureUserOnDefaultNetwork(telegramId);
  await ctx.reply(
    [
      'Welcome to ZeroKey Wallet MVP-A.',
      'This bot is custodial and testnet-only.',
      `Network: ${account.network.displayName} (${account.network.chainId})`,
      `Your USDC address: ${account.address}`,
      'Use /balance to check funds, /send <amount> <0x-address> to send USDC,',
      'or /switch <slug> to change networks (see /networks).',
    ].join('\n'),
  );
}
