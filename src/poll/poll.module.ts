import { Module, forwardRef } from '@nestjs/common';
import { AccountModule } from '../account/account.module';
import { DatabaseModule } from '../database/database.module';
import { ConfigModule } from '../config/config.module';
import { WalletModule } from '../wallet/wallet.module';
import { TransferModule } from '../transfer/transfer.module';
import { NetworkModule } from '../network/network.module';

import { PollMerkleCommitService } from './poll-merkle-commit.service';
import { PollService } from './poll.service';
import { PollTransferStakeSyncService } from './poll-transfer-stake-sync.service';
import { VoteIntentService } from './vote-intent.service';

@Module({
  imports: [
    DatabaseModule,
    ConfigModule,
    WalletModule,
    forwardRef(() => TransferModule),
    NetworkModule,
    AccountModule,
  ],
  providers: [
    PollService,
    VoteIntentService,
    PollMerkleCommitService,
    PollTransferStakeSyncService,
  ],
  exports: [PollService, VoteIntentService, PollTransferStakeSyncService],
})
export class PollModule {}
