import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Bot, type Context } from 'grammy';
import { AccountService } from '../account/account.service';
import {
  TRANSFER_CONFIRMED_EVENT,
  TRANSFER_FAILED_EVENT,
  type TransferStatusEvent,
} from '../common/events';
import { AppConfigService } from '../config/app-config.service';
import { NetworkRegistryService } from '../network/network-registry.service';
import { PollService } from '../poll/poll.service';
import { VoteIntentService } from '../poll/vote-intent.service';
import { TransferService } from '../transfer/transfer.service';
import { WalletService } from '../wallet/wallet.service';
import { handleAddress } from './handlers/address.handler';
import { handleBalance } from './handlers/balance.handler';
import { handleHelp } from './handlers/help.handler';
import { handleNetworks } from './handlers/networks.handler';
import { handleOtp } from './handlers/otp.handler';
import { handleSend } from './handlers/send.handler';
import { handleStart } from './handlers/start.handler';
import { handleSwitch } from './handlers/switch.handler';
import {
  handleClaimPollRewardCommand,
  handleClosePollCommand,
  handleCreatePoll,
  handlePollInfoQuery,
  handleResolvePollCommand,
  handlePollNativeVoteAnswer,
  handleVotePollCommand,
  handleVotePollDraftYesAcknowledgement,
} from './handlers/poll.handler';

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BotService.name);
  private readonly bot: Bot;

  constructor(
    @Inject(AppConfigService)
    appConfigService: AppConfigService,
    @Inject(AccountService)
    private readonly accountService: AccountService,
    @Inject(WalletService)
    private readonly walletService: WalletService,
    @Inject(TransferService)
    private readonly transferService: TransferService,
    @Inject(NetworkRegistryService)
    private readonly networkRegistryService: NetworkRegistryService,
    @Inject(PollService)
    private readonly pollService: PollService,
    @Inject(VoteIntentService)
    private readonly voteIntentService: VoteIntentService,
  ) {
    this.bot = new Bot(appConfigService.botToken);
  }

  async onModuleInit(): Promise<void> {
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

  private registerHandlers(): void {
    this.bot.command('start', (ctx) => handleStart(ctx, this.accountService));
    this.bot.command('address', (ctx) => handleAddress(ctx, this.accountService));
    this.bot.command('balance', (ctx) =>
      handleBalance(ctx, this.accountService, this.walletService),
    );
    this.bot.command('send', (ctx) =>
      handleSend(ctx, this.accountService, this.walletService, this.transferService),
    );
    this.bot.command('switch', (ctx) =>
      handleSwitch(ctx, this.accountService, this.networkRegistryService),
    );
    this.bot.command('networks', (ctx) =>
      handleNetworks(ctx, this.accountService, this.networkRegistryService),
    );
    this.bot.command('create_poll', (ctx) =>
      handleCreatePoll(ctx, this.accountService, this.pollService),
    );
    this.bot.on('poll_answer', (ctx) =>
      handlePollNativeVoteAnswer(
        ctx,
        this.accountService,
        this.walletService,
        this.voteIntentService,
        this.pollService,
      ),
    );
    this.bot.command('poll', (ctx) => handlePollInfoQuery(ctx, this.pollService));
    this.bot.command('vote_poll', (ctx) =>
      handleVotePollCommand(ctx, this.accountService, this.walletService, this.voteIntentService),
    );
    this.bot.hears(/^YES$/i, (ctx) =>
      handleVotePollDraftYesAcknowledgement(
        ctx,
        this.accountService,
        this.voteIntentService,
        this.walletService,
      ),
    );
    this.bot.command('close_poll', (ctx) =>
      handleClosePollCommand(ctx, this.pollService),
    );
    this.bot.command('resolve_poll', (ctx) =>
      handleResolvePollCommand(ctx, this.pollService),
    );
    this.bot.command('claim_poll', (ctx) =>
      handleClaimPollRewardCommand(ctx, this.pollService),
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
