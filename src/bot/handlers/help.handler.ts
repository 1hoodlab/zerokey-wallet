import type { Context } from 'grammy';

export async function handleHelp(ctx: Context): Promise<void> {
  await ctx.reply(
    [
      'ZeroKey Wallet commands:',
      '/start - create or view your wallet on the default network',
      '/address - show your address and QR for the current network',
      '/balance - show USDC balance on your current network',
      '/send <amount> <0x-address> - send USDC after OTP confirmation',
      '/networks - list available networks',
      '/switch <slug> - change your active network',
      '/create_poll <title> | <label A> | <label B> - opens a Telegram poll; default stake 10 USDC + YES flow',
      '/poll <poll-uuid> - poll status and stake sums',
      '/vote_poll <poll-uuid> <A|B> <amount> - stake any amount via command (alternative to tapping the poll)',
      '/close_poll <poll-uuid> - creator closes voting',
      '/resolve_poll <poll-uuid> <A|B> - creator resolves winners (Merkle payouts)',
      '/claim_poll <poll-uuid> - winners claim USDC from Merkle escrow contract',
      '/help - show this help',
      '',
      'Poll commands work in groups; OTP and spoilers are delivered in private DM. Open the bot (/start in DM) if you get no DM.',
      'Turn off Telegram bot Privacy Mode (@BotFather) if the bot should see /commands in groups.',
      '',
      'MVP-A is custodial and testnet-only.',
    ].join('\n'),
  );
}
