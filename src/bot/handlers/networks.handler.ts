import type { Context } from 'grammy';
import type { AccountService } from '../../account/account.service';
import type { NetworkRegistryService } from '../../network/network-registry.service';
import { getTelegramId } from './context';

export async function handleNetworks(
  ctx: Context,
  accountService: Pick<AccountService, 'getCurrentAccount'>,
  networkRegistryService: Pick<NetworkRegistryService, 'listEnabled'>,
): Promise<void> {
  const telegramId = getTelegramId(ctx);
  if (!telegramId) {
    await ctx.reply('Unable to identify your Telegram account.');
    return;
  }

  const [networks, currentAccount] = await Promise.all([
    networkRegistryService.listEnabled(),
    accountService.getCurrentAccount(telegramId),
  ]);

  const lines = networks.map((network) => {
    const marker = currentAccount.network.id === network.id ? ' [current]' : '';
    return `• ${network.slug} — ${network.displayName} (${network.chainId})${marker}`;
  });

  await ctx.reply(['Available networks:', ...lines, '', 'Use /switch <slug> to change.'].join('\n'));
}
