import { Test } from '@nestjs/testing';
import { AppConfigService } from '../config/app-config.service';
import { OtpService } from './otp.service';

describe('OtpService', () => {
  it('generates six numeric digits', async () => {
    const service = await createService();
    const otp = service.generateCode();

    expect(otp).toMatch(/^\d{6}$/);
  });

  it('hashes and verifies matching codes', async () => {
    const service = await createService();
    const hash = service.hashCode('142857');

    expect(service.verifyHash('142857', hash)).toBe(true);
    expect(service.verifyHash('000000', hash)).toBe(false);
  });

  it('detects expired creation times', async () => {
    const service = await createService();
    const createdAt = new Date(Date.now() - 301_000);

    expect(service.isExpired(createdAt)).toBe(true);
  });

  it('reports retries left after a wrong attempt', async () => {
    const service = await createService();

    expect(service.getRetriesLeft(1)).toBe(2);
    expect(service.getRetriesLeft(3)).toBe(0);
  });
});

async function createService(): Promise<OtpService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      OtpService,
      {
        provide: AppConfigService,
        useValue: {
          otpTtlSeconds: 300,
          otpMaxRetries: 3,
        },
      },
    ],
  }).compile();

  return moduleRef.get(OtpService);
}
