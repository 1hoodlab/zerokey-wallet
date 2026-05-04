import type { Context } from 'grammy';

import { AccountService } from '../../account/account.service';
import { WalletService } from '../../wallet/wallet.service';
import {
  pollSideFromLetter,
  pollSideFromTelegramPollOptionIndex,
} from '../../poll/allocate-binary-parimutuel';
import { PollService } from '../../poll/poll.service';
import { VoteIntentService } from '../../poll/vote-intent.service';
import { getMessageText, getTelegramId } from './context';
import { replyToUserPreferPrivateDm } from './message-delivery';

/** Fixed stake amount when voting via Telegram native poll (until amount UI exists). */
const DEFAULT_NATIVE_POLL_STAKE_USDC_AMOUNT = '10';

function escapeHtmlSpoiler(textPayload: string): string {
  return textPayload
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;');
}

export async function handleCreatePoll(
  ctx: Context,
  accountService: Pick<AccountService, 'getCurrentAccount'>,
  pollService: Pick<PollService, 'createPollEntry' | 'linkPollToTelegramNativePoll'>,
): Promise<void> {
  const participantTelegramNumeric = getTelegramId(ctx);
  if (!participantTelegramNumeric) {
    await ctx.reply('Unable to identify your Telegram account.');
    return;
  }

  const commandBodyText = getMessageText(ctx).trim().replace(/^\/create_poll\s*/i, '').trim();
  const pipePieces = commandBodyText
    .split('|')
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);

  if (pipePieces.length !== 3) {
    await ctx.reply('Usage: /create_poll <title> | <label A> | <label B>');
    return;
  }

  const pollTitle = pipePieces[0]!;
  const sideAText = pipePieces[1]!;
  const sideBText = pipePieces[2]!;

  if (pollTitle.length > 280 || sideAText.length > 80 || sideBText.length > 80) {
    await ctx.reply('Title or side label too long.');
    return;
  }

  const creatorAccount = await accountService.getCurrentAccount(participantTelegramNumeric);

  const freshlyCreatedPollEnvelope = await pollService.createPollEntry({
    creatorTelegramId: participantTelegramNumeric,
    networkIdReference: creatorAccount.network.id,
    title: pollTitle,
    sideLabelA: sideAText,
    sideLabelB: sideBText,
  });

  const pollIdStored = freshlyCreatedPollEnvelope.pollId;

  try {
    const telegramPollTransmission = await ctx.api.sendPoll(
      ctx.chat?.id ?? Number(participantTelegramNumeric),
      pollTitle.slice(0, 300),
      [{ text: sideAText.slice(0, 100) }, { text: sideBText.slice(0, 100) }],
      {
        is_anonymous: false,
        type: 'regular',
        allows_multiple_answers: false,
        allows_revoting: false,
        description: [
          `Default stake: <b>${DEFAULT_NATIVE_POLL_STAKE_USDC_AMOUNT} USDC</b>. Tap an option, then reply <b>YES</b>.`,
          '',
          `<code>${pollIdStored}</code>`,
        ]
          .join('\n')
          .slice(0, 1024),
        description_parse_mode: 'HTML',
      },
    );

    const telegramNativePollCredential = telegramPollTransmission.poll?.id;
    if (!telegramNativePollCredential) {
      throw new Error('Telegram returned no poll id.');
    }

    await pollService.linkPollToTelegramNativePoll({
      pollId: pollIdStored,
      telegramPollId: telegramNativePollCredential,
    });
  } catch (nativePollLinkageFailure: unknown) {
    const remediationHint =
      nativePollLinkageFailure instanceof Error
        ? nativePollLinkageFailure.message
        : 'unknown error';

    await ctx.reply(
      [
        `Poll id: <code>${pollIdStored}</code>`,
        `Telegram native poll failed (${escapeHtmlSpoiler(remediationHint)}).`,
        `Vote manually: /vote_poll ${pollIdStored} A or B amount`,
      ].join('\n'),
      { parse_mode: 'HTML' },
    );
  }
}

export async function handlePollInfoQuery(
  ctx: Context,
  pollService: Pick<PollService, 'summarizePollForTelegram'>,
): Promise<void> {
  if (!getTelegramId(ctx)) {
    await ctx.reply('Unable to identify your Telegram account.');
    return;
  }

  const tokenizedCommand = getMessageText(ctx).trim().split(/\s+/);
  if (tokenizedCommand.length !== 2) {
    await ctx.reply('Usage: /poll <poll-uuid>');
    return;
  }

  const pollUuid = tokenizedCommand[1]!;

  try {
    const renderedSummary = await pollService.summarizePollForTelegram(pollUuid);
    await ctx.reply(renderedSummary, { parse_mode: 'HTML' });
  } catch (caughtErrorUnknown) {
    const readableMessage =
      caughtErrorUnknown instanceof Error ? caughtErrorUnknown.message : 'Error';
    await ctx.reply(readableMessage);
  }
}

export async function handleVotePollCommand(
  ctx: Context,
  accountService: Pick<AccountService, 'getCurrentAccount'>,
  walletService: Pick<WalletService, 'parseUsdc' | 'formatUsdc'>,
  voteIntentService: Pick<VoteIntentService, 'beginDraftVoteIntent'>,
): Promise<void> {
  const voterTelegramNumeric = getTelegramId(ctx);
  if (!voterTelegramNumeric) {
    await ctx.reply('Unable to identify your Telegram account.');
    return;
  }

  const commandTokens = getMessageText(ctx).trim().split(/\s+/);
  if (commandTokens.length !== 4) {
    await ctx.reply('Usage: /vote_poll <poll-uuid> <A|B> <amount>');
    return;
  }

  const pollUuidReferenced = commandTokens[1]!;
  const sideToken = commandTokens[2]!;
  const amountLiterals = commandTokens[3]!;

  const parsedWinnerSideGuess = pollSideFromLetter(sideToken);
  if (!parsedWinnerSideGuess) {
    await ctx.reply('Side must be A or B.');
    return;
  }

  const stakingAccountEnvelope = await accountService.getCurrentAccount(voterTelegramNumeric);

  let localizedStakeDenominationAtomic: bigint;
  try {
    localizedStakeDenominationAtomic = await walletService.parseUsdc(
      amountLiterals,
      stakingAccountEnvelope.network,
    );
  } catch {
    await ctx.reply('Invalid USDC amount.');
    return;
  }

  if (localizedStakeDenominationAtomic <= 0n) {
    await ctx.reply('Amount must be greater than zero.');
    return;
  }

  try {
    const provisionalIntentFingerprint = await voteIntentService.beginDraftVoteIntent({
      pollId: pollUuidReferenced,
      telegramUserId: voterTelegramNumeric,
      chosenOutcome: parsedWinnerSideGuess,
      stakeAmountBaseUnits: localizedStakeDenominationAtomic,
    });

    const prettifiedLiquidityDenominationHumanized = escapeHtmlSpoiler(
      await walletService.formatUsdc(
        localizedStakeDenominationAtomic,
        stakingAccountEnvelope.network,
      ),
    );

    await replyToUserPreferPrivateDm(
      ctx,
      [
        `Stake preview: ${prettifiedLiquidityDenominationHumanized} USDC on ${sideToken.toUpperCase()}?`,
        `Intent <code>${provisionalIntentFingerprint.voteIntentId}</code>`,
        '',
        'Reply YES (case-insensitive) in the group or in this chat; OTP is always sent privately.',
      ].join('\n'),
      { parse_mode: 'HTML' },
    );
  } catch (thrownOperationalFailure) {
    await ctx.reply(
      thrownOperationalFailure instanceof Error ? thrownOperationalFailure.message : 'Failed',
    );
  }
}

/**
 * Telegram native poll taps (non-anonymous sendPoll): opens a draft with {@link DEFAULT_NATIVE_POLL_STAKE_USDC_AMOUNT} USDC.
 * User confirms with YES + OTP flow (same as /vote_poll).
 */
export async function handlePollNativeVoteAnswer(
  ctx: Context,
  accountService: Pick<AccountService, 'getCurrentAccount'>,
  walletService: Pick<WalletService, 'parseUsdc' | 'formatUsdc'>,
  voteIntentService: Pick<VoteIntentService, 'beginDraftVoteIntent'>,
  pollService: Pick<PollService, 'lookupOpenPollStakeContextByTelegramPollId'>,
): Promise<void> {
  const answerEnvelope = ctx.pollAnswer;
  if (!answerEnvelope || answerEnvelope.option_ids.length === 0) {
    return;
  }

  const voterHumanProfileId = answerEnvelope.user?.id;
  if (voterHumanProfileId === undefined) {
    return;
  }

  const firstSelectedOptionOrdinal = answerEnvelope.option_ids[0];
  const parsedChosenParimutuelSide =
    firstSelectedOptionOrdinal === undefined
      ? null
      : pollSideFromTelegramPollOptionIndex(firstSelectedOptionOrdinal);

  if (!parsedChosenParimutuelSide) {
    await ctx.api.sendMessage(
      voterHumanProfileId,
      'Poll option is not mapped to side A/B for staking.',
    );
    return;
  }

  const openPollLinkageRecord = await pollService.lookupOpenPollStakeContextByTelegramPollId(
    answerEnvelope.poll_id,
  );

  if (!openPollLinkageRecord) {
    await ctx.api.sendMessage(voterHumanProfileId, 'This poll is unknown or closed.');
    return;
  }

  const voterTelegramLedgerKey = BigInt(voterHumanProfileId);

  let stakingAccountEnvelope;
  try {
    stakingAccountEnvelope = await accountService.getCurrentAccount(voterTelegramLedgerKey);
  } catch {
    await ctx.api.sendMessage(
      voterHumanProfileId,
      'Complete /start and select a wallet network before staking.',
    );
    return;
  }

  if (stakingAccountEnvelope.network.id !== openPollLinkageRecord.networkId) {
    await ctx.api.sendMessage(
      voterHumanProfileId,
      'Switch to the poll network with /switch, then tap your vote again.',
    );
    return;
  }

  let localizedStakeDenominationAtomic: bigint;
  try {
    localizedStakeDenominationAtomic = await walletService.parseUsdc(
      DEFAULT_NATIVE_POLL_STAKE_USDC_AMOUNT,
      stakingAccountEnvelope.network,
    );
  } catch {
    await ctx.api.sendMessage(
      voterHumanProfileId,
      'Could not interpret default stake amount for this network.',
    );
    return;
  }

  if (localizedStakeDenominationAtomic <= 0n) {
    await ctx.api.sendMessage(voterHumanProfileId, 'Default stake amount invalid.');
    return;
  }

  try {
    const provisionalIntentFingerprint = await voteIntentService.beginDraftVoteIntent({
      pollId: openPollLinkageRecord.pollId,
      telegramUserId: voterTelegramLedgerKey,
      chosenOutcome: parsedChosenParimutuelSide,
      stakeAmountBaseUnits: localizedStakeDenominationAtomic,
    });

    const prettifiedLiquidityDenominationHumanized = escapeHtmlSpoiler(
      await walletService.formatUsdc(
        localizedStakeDenominationAtomic,
        stakingAccountEnvelope.network,
      ),
    );

    const sideLetterDisplay = parsedChosenParimutuelSide === 'SIDE_A' ? 'A' : 'B';

    await ctx.api.sendMessage(
      voterHumanProfileId,
      [
        `Stake preview: ${prettifiedLiquidityDenominationHumanized} USDC on ${sideLetterDisplay}?`,
        `Intent <code>${provisionalIntentFingerprint.voteIntentId}</code>`,
        '',
        'Reply YES (case-insensitive) in the group or in this chat; OTP is always sent privately.',
      ].join('\n'),
      { parse_mode: 'HTML' },
    );
  } catch (thrownOperationalFailure: unknown) {
    const failureNarrative =
      thrownOperationalFailure instanceof Error ? thrownOperationalFailure.message : 'Failed.';
    await ctx.api.sendMessage(voterHumanProfileId, failureNarrative);
  }
}

export async function handleVotePollDraftYesAcknowledgement(
  ctx: Context,
  accountService: Pick<AccountService, 'getCurrentAccount'>,
  voteIntentService: Pick<
    VoteIntentService,
    'locateLatestUnexpiredDraftIntent' | 'confirmDraftAndBeginEscrowTransfer'
  >,
  walletService: Pick<WalletService, 'formatUsdc'>,
): Promise<void> {
  const reactingUserNumeric = getTelegramId(ctx);
  if (!reactingUserNumeric) {
    await ctx.reply('Unable to identify your Telegram account.');
    return;
  }

  try {
    const draftIntentFingerprint = await voteIntentService.locateLatestUnexpiredDraftIntent(
      reactingUserNumeric,
    );

    if (!draftIntentFingerprint) {
      await ctx.reply('No draft vote intent awaiting YES.');
      return;
    }

    const initiatedEscrowLiquidityRelay = await voteIntentService.confirmDraftAndBeginEscrowTransfer({
      voteIntentId: draftIntentFingerprint,
      telegramUserId: reactingUserNumeric,
    });

    const operatorSelectedNetworkAccount = await accountService.getCurrentAccount(
      reactingUserNumeric,
    );

    const otpDisplayEscaped = escapeHtmlSpoiler(initiatedEscrowLiquidityRelay.otpCodePlaintext);

    const amountHumanizedEscaped = escapeHtmlSpoiler(
      await walletService.formatUsdc(
        initiatedEscrowLiquidityRelay.stakeAmountBaseUnits,
        operatorSelectedNetworkAccount.network,
      ),
    );

    await replyToUserPreferPrivateDm(
      ctx,
      [
        `Stake ${amountHumanizedEscaped} USDC`,
        `OTP: <tg-spoiler>${otpDisplayEscaped}</tg-spoiler>`,
        'Reply with the 6-digit OTP within five minutes in this chat (never post the OTP in a group).',
      ].join('\n'),
      { parse_mode: 'HTML' },
    );
  } catch (errorDuringConfirmation) {
    await replyToUserPreferPrivateDm(
      ctx,
      errorDuringConfirmation instanceof Error ? errorDuringConfirmation.message : 'YES failed.',
    );
  }
}

export async function handleClosePollCommand(
  ctx: Context,
  pollService: Pick<PollService, 'closePollForCreator'>,
): Promise<void> {
  const operatorTelegram = getTelegramId(ctx);
  if (!operatorTelegram) {
    await ctx.reply('Unable to identify your Telegram account.');
    return;
  }

  const parts = getMessageText(ctx).trim().split(/\s+/);
  if (parts.length !== 2) {
    await ctx.reply('Usage: /close_poll <poll-uuid>');
    return;
  }

  try {
    await pollService.closePollForCreator({ pollId: parts[1]!, creatorTelegramId: operatorTelegram });
    await ctx.reply('Poll closed.');
  } catch (caughtOperational) {
    await ctx.reply(caughtOperational instanceof Error ? caughtOperational.message : 'Close failed.');
  }
}

export async function handleResolvePollCommand(
  ctx: Context,
  pollService: Pick<PollService, 'resolvePollWithMerkleSettlement'>,
): Promise<void> {
  const operatorTelegram = getTelegramId(ctx);
  if (!operatorTelegram) {
    await ctx.reply('Unable to identify your Telegram account.');
    return;
  }

  const segmented = getMessageText(ctx).trim().split(/\s+/);
  if (segmented.length !== 3) {
    await ctx.reply('Usage: /resolve_poll <poll-uuid> <A|B>');
    return;
  }

  const winningLetterSide = pollSideFromLetter(segmented[2]!);
  if (!winningLetterSide) {
    await ctx.reply('Winning side must be A or B.');
    return;
  }

  try {
    await pollService.resolvePollWithMerkleSettlement({
      pollId: segmented[1]!,
      creatorTelegramId: operatorTelegram,
      winningSide: winningLetterSide,
    });
    await ctx.reply('Poll resolved and Merkle settlement prepared.');
  } catch (caughtFailure) {
    await ctx.reply(
      caughtFailure instanceof Error ? caughtFailure.message : 'Resolve failed.',
    );
  }
}

export async function handleClaimPollRewardCommand(
  ctx: Context,
  pollService: Pick<PollService, 'submitMerkleClaimForParticipant'>,
): Promise<void> {
  const claimantTelegram = getTelegramId(ctx);
  if (!claimantTelegram) {
    await ctx.reply('Unable to identify your Telegram account.');
    return;
  }

  const lexicalParts = getMessageText(ctx).trim().split(/\s+/);
  if (lexicalParts.length !== 2) {
    await ctx.reply('Usage: /claim_poll <poll-uuid>');
    return;
  }

  try {
    const claimTxHashFingerprint = await pollService.submitMerkleClaimForParticipant({
      pollId: lexicalParts[1]!,
      telegramParticipantId: claimantTelegram,
    });
    await ctx.reply(`Submitted claim tx: <code>${claimTxHashFingerprint}</code>`, {
      parse_mode: 'HTML',
    });
  } catch (rejectReason) {
    await ctx.reply(
      rejectReason instanceof Error ? rejectReason.message : 'Claim failed.',
    );
  }
}
