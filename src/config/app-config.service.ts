import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getAddress, type Hex } from 'viem';

@Injectable()
export class AppConfigService {
  constructor(
    @Inject(ConfigService)
    private readonly configService: ConfigService,
  ) {}

  get databaseUrl(): string {
    return this.configService.getOrThrow<string>('DATABASE_URL');
  }

  get botToken(): string {
    return this.configService.getOrThrow<string>('BOT_TOKEN');
  }

  get serverEoaPrivateKey(): Hex {
    return this.configService.getOrThrow<Hex>('SERVER_EOA_PRIVATE_KEY');
  }

  get pimlicoApiKey(): string {
    return this.configService.getOrThrow<string>('PIMLICO_API_KEY');
  }

  get otpTtlSeconds(): number {
    return Number(this.configService.getOrThrow<number>('OTP_TTL_SECONDS'));
  }

  get otpMaxRetries(): number {
    return Number(this.configService.getOrThrow<number>('OTP_MAX_RETRIES'));
  }

  pollEscrowContractAddress(): Hex {
    return getAddress(this.configService.getOrThrow<string>('POLL_USDC_ESCROW_ADDRESS'));
  }

  /**
   * Optional key used only to broadcast `commitPayoutRoot`. Prefer multisig / cold key and fund with gas.
   */
  get merkleEscrowOwnerPrivateKey(): Hex | undefined {
    const rawKey = this.configService.get<string>('MERKLE_ESCROW_OWNER_PRIVATE_KEY');
    return rawKey && rawKey.startsWith('0x') ? (rawKey as Hex) : undefined;
  }

  get logLevel(): string {
    return this.configService.getOrThrow<string>('LOG_LEVEL');
  }
}
