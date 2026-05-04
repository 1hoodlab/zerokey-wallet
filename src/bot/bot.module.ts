import { Module } from '@nestjs/common';
import { AccountModule } from '../account/account.module';
import { ConfigModule } from '../config/config.module';
import { NetworkModule } from '../network/network.module';
import { PollModule } from '../poll/poll.module';
import { TransferModule } from '../transfer/transfer.module';
import { WalletModule } from '../wallet/wallet.module';
import { BotService } from './bot.service';

@Module({
  imports: [AccountModule, ConfigModule, NetworkModule, PollModule, TransferModule, WalletModule],
  providers: [BotService],
})
export class BotModule {}
