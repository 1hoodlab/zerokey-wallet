import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Hex } from 'viem';

@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService) {}

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

  get baseSepoliaRpcUrl(): string {
    return this.configService.getOrThrow<string>('BASE_SEPOLIA_RPC_URL');
  }

  get usdcAddress(): Hex {
    return this.configService.getOrThrow<Hex>('USDC_ADDRESS_BASE_SEPOLIA');
  }

  get otpTtlSeconds(): number {
    return Number(this.configService.getOrThrow<number>('OTP_TTL_SECONDS'));
  }

  get otpMaxRetries(): number {
    return Number(this.configService.getOrThrow<number>('OTP_MAX_RETRIES'));
  }

  get logLevel(): string {
    return this.configService.getOrThrow<string>('LOG_LEVEL');
  }
}
