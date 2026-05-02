export class InsufficientBalanceError extends Error {
  constructor() {
    super('Insufficient USDC balance');
  }
}

export class NoPendingTransferError extends Error {
  constructor() {
    super('No pending transfer');
  }
}

export class OtpExpiredError extends Error {
  constructor() {
    super('OTP expired');
  }
}

export class OtpInvalidError extends Error {
  constructor(public readonly retriesLeft: number) {
    super('Invalid OTP');
  }
}

export class TooManyOtpAttemptsError extends Error {
  constructor() {
    super('Too many OTP attempts');
  }
}

export class WalletNetworkError extends Error {
  constructor(message = 'Wallet network error') {
    super(message);
  }
}
