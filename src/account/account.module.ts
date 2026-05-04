import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { NetworkModule } from '../network/network.module';
import { WalletModule } from '../wallet/wallet.module';
import { AccountService } from './account.service';

@Module({
  imports: [DatabaseModule, NetworkModule, WalletModule],
  providers: [AccountService],
  exports: [AccountService],
})
export class AccountModule {}
