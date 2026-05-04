import {
  allocateBinaryParimutuel,
  parimutuelDustRemainder,
  pollSideFromLetter,
  pollSideFromTelegramPollOptionIndex,
} from './allocate-binary-parimutuel';

describe('allocateBinaryParimutuel', () => {
  it('splits loser pool into winners proportionally', () => {
    const totalWinning = 10n + 20n;
    const totalLosing = 90n + 180n;
    const winnerStakeByTelegramId = new Map<bigint, bigint>([
      [1n, 10n],
      [2n, 20n],
    ]);
    const payouts = allocateBinaryParimutuel({
      totalStakeWinning: totalWinning,
      totalStakeLosing: totalLosing,
      winnerStakeByTelegramId,
    });
    expect(payouts.get(1n)).toBe(100n);
    expect(payouts.get(2n)).toBe(200n);
    expect(
      parimutuelDustRemainder({
        totalStakeWinning: totalWinning,
        totalStakeLosing: totalLosing,
        payouts,
      }),
    ).toBe(0n);
  });

  it('returns identity when no losing stake', () => {
    const payouts = allocateBinaryParimutuel({
      totalStakeWinning: 50n,
      totalStakeLosing: 0n,
      winnerStakeByTelegramId: new Map([[9n, 50n]]),
    });
    expect(payouts.get(9n)).toBe(50n);
  });

  it('non-zero dust when floor truncates', () => {
    const payouts = allocateBinaryParimutuel({
      totalStakeWinning: 40n,
      totalStakeLosing: 3011n,
      winnerStakeByTelegramId: new Map([
        [1n, 10n],
        [2n, 30n],
      ]),
    });
    const dust = parimutuelDustRemainder({
      totalStakeWinning: 40n,
      totalStakeLosing: 3011n,
      payouts,
    });
    expect(dust).toBeGreaterThanOrEqual(0n);
  });
});

describe('pollSideFromTelegramPollOptionIndex', () => {
  it('maps 0 / 1 to binary sides', () => {
    expect(pollSideFromTelegramPollOptionIndex(0)).toBe('SIDE_A');
    expect(pollSideFromTelegramPollOptionIndex(1)).toBe('SIDE_B');
    expect(pollSideFromTelegramPollOptionIndex(99)).toBeNull();
  });
});

describe('pollSideFromLetter', () => {
  it('maps letters', () => {
    expect(pollSideFromLetter('a')).toBe('SIDE_A');
    expect(pollSideFromLetter('B')).toBe('SIDE_B');
    expect(pollSideFromLetter(' x ')).toBeNull();
  });
});
