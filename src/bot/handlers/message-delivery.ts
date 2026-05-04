import type { Context } from 'grammy';

interface ReplyOptionsSubset {
  parse_mode?: 'HTML';
}

/** In private chats: normal reply. In groups/channels: send full text via DM then a short in-chat ack. */
export async function replyToUserPreferPrivateDm(
  ctx: Context,
  fullMessagePayload: string,
  options?: ReplyOptionsSubset,
): Promise<void> {
  if (ctx.chat?.type === 'private') {
    await ctx.reply(fullMessagePayload, options);
    return;
  }

  const directMessageRecipientId = ctx.from?.id;
  if (directMessageRecipientId === undefined) {
    await ctx.reply('Cannot identify user for a private message.');
    return;
  }

  try {
    await ctx.api.sendMessage(directMessageRecipientId, fullMessagePayload, options);
    await ctx.reply(
      'Sent you a private message (OTP / sensitive details). Open the bot DM if empty.',
    );
  } catch {
    await ctx.reply(
      [
        'I could not message you privately. Open my chat and press /start, then retry.',
      ].join('\n'),
    );
  }
}
