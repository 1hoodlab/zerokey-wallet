import type { Context } from 'grammy';

export async function handleHelp(ctx: Context): Promise<void> {
  await ctx.reply(
    [
      'ZeroKey Wallet commands:',
      '/start - create or view your testnet wallet',
      '/address - show your address and QR code',
      '/balance - show BSC testnet USDC balance',
      '/send <amount> <0x-address> - send USDC after OTP confirmation',
      '/help - show this help',
      '',
      'MVP-A is custodial and BSC testnet-only.',
    ].join('\n'),
  );
}
