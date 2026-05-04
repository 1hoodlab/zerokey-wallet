import type { Context } from 'grammy';
import type { AccountService } from '../../account/account.service';
import type { NetworkRegistryService } from '../../network/network-registry.service';
import { getMessageText, getTelegramId } from './context';

export async function handleSwitch(
  ctx: Context,
  accountService: Pick<AccountService, 'switchNetwork'>,
  networkRegistryService: Pick<NetworkRegistryService, 'findBySlug' | 'listEnabled'>,
): Promise<void> {
  const telegramId = getTelegramId(ctx);
  if (!telegramId) {
    await ctx.reply('Unable to identify your Telegram account.');
    return;
  }

  const parts = getMessageText(ctx).trim().split(/\s+/);
  if (parts.length !== 2) {
    await ctx.reply('Usage: /switch <network_slug>');
    return;
  }
  const slug = parts[1];

  const network = await networkRegistryService.findBySlug(slug);
  if (!network) {
    const enabledNetworks = await networkRegistryService.listEnabled();
    const slugList = enabledNetworks.map((entry) => entry.slug).join(', ');
    await ctx.reply(`Unknown network. Try /networks.\nAvailable: ${slugList}`);
    return;
  }

  const switchedAccount = await accountService.switchNetwork(telegramId, network);
  await ctx.reply(
    [
      `Switched to ${network.displayName} (${network.chainId}).`,
      `Address: ${switchedAccount.address}`,
    ].join('\n'),
  );
}
