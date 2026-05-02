import { Module } from '@nestjs/common';
import { OtpModule } from '../otp/otp.module';
import { WalletModule } from '../wallet/wallet.module';
import { TransferService } from './transfer.service';

@Module({
  imports: [OtpModule, WalletModule],
  providers: [TransferService],
  exports: [TransferService],
})
export class TransferModule {}
