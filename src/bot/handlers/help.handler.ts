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
      '/help - show this help',
      '',
      'MVP-A is custodial and testnet-only.',
    ].join('\n'),
  );
}
