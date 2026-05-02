import type { Hex } from 'viem';

export interface DerivedAccount {
  telegramId: bigint;
  address: Hex;
}

export interface TransferRequest {
  telegramId: bigint;
  recipientAddress: Hex;
  amountBaseUnits: bigint;
}
