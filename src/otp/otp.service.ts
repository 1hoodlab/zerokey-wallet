import { Injectable } from '@nestjs/common';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class OtpService {
  constructor(private readonly appConfigService: AppConfigService) {}

  generateCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  hashCode(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  verifyHash(code: string, expectedHash: string): boolean {
    const actualHash = this.hashCode(code);
    const actualBuffer = Buffer.from(actualHash, 'hex');
    const expectedBuffer = Buffer.from(expectedHash, 'hex');

    if (actualBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(actualBuffer, expectedBuffer);
  }

  isExpired(createdAt: Date): boolean {
    const ageMilliseconds = Date.now() - createdAt.getTime();
    return ageMilliseconds > this.appConfigService.otpTtlSeconds * 1000;
  }

  getRetriesLeft(retryCountAfterFailure: number): number {
    return Math.max(this.appConfigService.otpMaxRetries - retryCountAfterFailure, 0);
  }
}
