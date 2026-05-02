import type { Context } from 'grammy';

export function getTelegramId(ctx: Context): bigint | null {
  if (!ctx.from?.id) {
    return null;
  }

  return BigInt(ctx.from.id);
}

export function getMessageText(ctx: Context): string {
  return ctx.message?.text ?? '';
}
