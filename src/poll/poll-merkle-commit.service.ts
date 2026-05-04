import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Network } from '@prisma/client';
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { AppConfigService } from '../config/app-config.service';
import { NetworkRegistryService } from '../network/network-registry.service';
import { merklePayoutEscrowAbi } from './merkle-payout-escrow.abi';

@Injectable()
export class PollMerkleCommitService {
  private readonly logger = new Logger(PollMerkleCommitService.name);

  constructor(
    @Inject(AppConfigService)
    private readonly appConfigService: AppConfigService,
    @Inject(NetworkRegistryService)
    private readonly networkRegistryService: NetworkRegistryService,
  ) {}

  async broadcastCommitRootTransaction(parameters: {
    readonly network: Network;
    readonly payoutId: Hex;
    readonly merkleRoot: Hex;
  }): Promise<Hex | null> {
    const ownerPrivateKey = this.appConfigService.merkleEscrowOwnerPrivateKey;
    if (ownerPrivateKey === undefined) {
      this.logger.warn(
        'MERKLE_ESCROW_OWNER_PRIVATE_KEY unset; Merkle root stored in DB only until manual commit.',
      );
      return null;
    }

    const tokenAddressHex = getAddress(parameters.network.usdcAddress);
    const escrowAddressHex = this.appConfigService.pollEscrowContractAddress();

    const viemChainDefinition = this.networkRegistryService.toViemChain(parameters.network);
    const rpcHttpTransport = http(parameters.network.rpcUrl);

    const confirmationClient = createPublicClient({
      chain: viemChainDefinition,
      transport: rpcHttpTransport,
    });

    const signingAccount = privateKeyToAccount(ownerPrivateKey);
    const signerWalletClient = createWalletClient({
      account: signingAccount,
      chain: viemChainDefinition,
      transport: rpcHttpTransport,
    });

    const encodedCommitPayload = encodeFunctionData({
      abi: merklePayoutEscrowAbi,
      functionName: 'commitPayoutRoot',
      args: [parameters.payoutId, tokenAddressHex, parameters.merkleRoot],
    });

    const submissionHash = await signerWalletClient.sendTransaction({
      to: escrowAddressHex,
      value: 0n,
      data: encodedCommitPayload,
    });

    await confirmationClient.waitForTransactionReceipt({ hash: submissionHash });

    this.logger.log(
      { payoutId: parameters.payoutId, hash: submissionHash },
      'Committed Merkle payout root on-chain',
    );
    return submissionHash;
  }
}
