import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { LoggerModule } from 'nestjs-pino';
import { AccountModule } from './account/account.module';
import { BotModule } from './bot/bot.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { OtpModule } from './otp/otp.module';
import { TransferModule } from './transfer/transfer.module';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [
    AccountModule,
    BotModule,
    ConfigModule,
    DatabaseModule,
    OtpModule,
    TransferModule,
    WalletModule,
    EventEmitterModule.forRoot(),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        redact: ['*.privateKey', '*.otp', '*.otpHash', 'req.headers.authorization'],
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : {
                target: 'pino-pretty',
              },
      },
    }),
  ],
})
export class AppModule {}
