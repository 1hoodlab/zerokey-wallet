import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { WalletService } from './wallet.service';

@Module({
  imports: [ConfigModule],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
