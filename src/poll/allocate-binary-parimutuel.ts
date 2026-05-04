import type { PollSide } from '@prisma/client';

export interface AllocateBinaryParimutuelParameters {
  readonly totalStakeWinning: bigint;
  readonly totalStakeLosing: bigint;
  readonly winnerStakeByTelegramId: ReadonlyMap<bigint, bigint>;
}

export function allocateBinaryParimutuel(
  parameters: AllocateBinaryParimutuelParameters,
): ReadonlyMap<bigint, bigint> {
  const winningTotal = parameters.totalStakeWinning;
  if (winningTotal === 0n) {
    throw new RangeError('Parimutuel requires positive winning stake total');
  }
  const grossPool = winningTotal + parameters.totalStakeLosing;
  const results = new Map<bigint, bigint>();
  for (const [
    participantTelegramId,
    stakeAmountOnWinningOutcome,
  ] of parameters.winnerStakeByTelegramId.entries()) {
    const payoutSlice =
      (stakeAmountOnWinningOutcome * grossPool) / winningTotal;
    if (payoutSlice > 0n) {
      results.set(participantTelegramId, payoutSlice);
    }
  }
  return results;
}

export function parimutuelDustRemainder(parameters: {
  readonly totalStakeWinning: bigint;
  readonly totalStakeLosing: bigint;
  readonly payouts: ReadonlyMap<bigint, bigint>;
}): bigint {
  const grossPool = parameters.totalStakeWinning + parameters.totalStakeLosing;
  let distributedAccumulator = 0n;
  for (const slice of parameters.payouts.values()) {
    distributedAccumulator += slice;
  }
  return grossPool - distributedAccumulator;
}

export function pollSideFromLetter(letter: string): PollSide | null {
  const normalized = letter.trim().toUpperCase();
  if (normalized === 'A') {
    return 'SIDE_A';
  }
  if (normalized === 'B') {
    return 'SIDE_B';
  }
  return null;
}

/** Maps Telegram sendPoll answer option index (0-based) to our binary sides. */
export function pollSideFromTelegramPollOptionIndex(optionIndex: number): PollSide | null {
  if (optionIndex === 0) {
    return 'SIDE_A';
  }
  if (optionIndex === 1) {
    return 'SIDE_B';
  }
  return null;
}
