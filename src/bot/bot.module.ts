import { Module } from '@nestjs/common';
import { AccountModule } from '../account/account.module';
import { ConfigModule } from '../config/config.module';
import { NetworkModule } from '../network/network.module';
import { TransferModule } from '../transfer/transfer.module';
import { WalletModule } from '../wallet/wallet.module';
import { BotService } from './bot.service';

@Module({
  imports: [AccountModule, ConfigModule, NetworkModule, TransferModule, WalletModule],
  providers: [BotService],
})
export class BotModule {}
