import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { NetworkModule } from '../network/network.module';
import { WalletService } from './wallet.service';

@Module({
  imports: [ConfigModule, NetworkModule],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
