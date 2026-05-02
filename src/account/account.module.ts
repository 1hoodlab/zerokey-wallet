import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { AccountService } from './account.service';

@Module({
  imports: [WalletModule],
  providers: [AccountService],
  exports: [AccountService],
})
export class AccountModule {}
