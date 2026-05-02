import type { Hex } from 'viem';

export const TRANSFER_CONFIRMED_EVENT = 'transfer.confirmed';
export const TRANSFER_FAILED_EVENT = 'transfer.failed';

export interface TransferStatusEvent {
  chatId: bigint;
  hash: Hex;
  reason?: string;
}
