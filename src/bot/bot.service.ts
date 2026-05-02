import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Bot, type Context } from 'grammy';
import { AccountService } from '../account/account.service';
import {
  TRANSFER_CONFIRMED_EVENT,
  TRANSFER_FAILED_EVENT,
  type TransferStatusEvent,
} from '../common/events';
import { AppConfigService } from '../config/app-config.service';
import { TransferService } from '../transfer/transfer.service';
import { WalletService } from '../wallet/wallet.service';
import { handleAddress } from './handlers/address.handler';
import { handleBalance } from './handlers/balance.handler';
import { handleHelp } from './handlers/help.handler';
import { handleOtp } from './handlers/otp.handler';
import { handleSend } from './handlers/send.handler';
import { handleStart } from './handlers/start.handler';

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BotService.name);
  private readonly bot: Bot;

  constructor(
    appConfigService: AppConfigService,
    private readonly accountService: AccountService,
    private readonly walletService: WalletService,
    private readonly transferService: TransferService,
  ) {
    this.bot = new Bot(appConfigService.botToken);
  }

  async onModuleInit(): Promise<void> {
    this.registerMiddleware();
    this.registerHandlers();
    await this.bot.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.bot.stop();
  }

  @OnEvent(TRANSFER_CONFIRMED_EVENT)
  async handleTransferConfirmed(event: TransferStatusEvent): Promise<void> {
    await this.bot.api.sendMessage(Number(event.chatId), `Transfer confirmed: ${event.hash}`);
  }

  @OnEvent(TRANSFER_FAILED_EVENT)
  async handleTransferFailed(event: TransferStatusEvent): Promise<void> {
    await this.bot.api.sendMessage(
      Number(event.chatId),
      `Transfer failed: ${event.reason ?? event.hash}`,
    );
  }

  private registerMiddleware(): void {
    this.bot.use(async (ctx, next) => {
      if (ctx.chat && ctx.chat.type !== 'private') {
        await ctx.reply('Please use this bot in a private chat.');
        return;
      }

      await next();
    });
  }

  private registerHandlers(): void {
    this.bot.command('start', (ctx) => handleStart(ctx, this.accountService));
    this.bot.command('address', (ctx) => handleAddress(ctx, this.accountService));
    this.bot.command('balance', (ctx) =>
      handleBalance(ctx, this.accountService, this.walletService),
    );
    this.bot.command('send', (ctx) =>
      handleSend(ctx, this.accountService, this.walletService, this.transferService),
    );
    this.bot.command('help', handleHelp);
    this.bot.hears(/^\d{6}$/, (ctx: Context) =>
      handleOtp(ctx, this.accountService, this.transferService),
    );
    this.bot.catch(async (error) => {
      this.logger.error({ err: error.error }, 'Telegram bot handler failed');
      await error.ctx.reply('Something went wrong. Try again or /help.');
    });
  }
}
