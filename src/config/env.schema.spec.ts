import { ConfigService } from '@nestjs/config';
import { envSchema } from './env.schema';
import { AppConfigService } from './app-config.service';

describe('config', () => {
  const validEnvironment = {
    DATABASE_URL: 'postgresql://zerokey:zerokey_local@localhost:5432/zerokey_wallet',
    BOT_TOKEN: '1234567:ABCDEF',
    SERVER_EOA_PRIVATE_KEY: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    PIMLICO_API_KEY: 'test-pimlico-api-key',
    POLL_USDC_ESCROW_ADDRESS: '0xd73d3e44a6184179cd9c09cb2e2647981b716568',
    OTP_TTL_SECONDS: 300,
    OTP_MAX_RETRIES: 3,
    LOG_LEVEL: 'info',
    NODE_ENV: 'test',
  };

  it('accepts Pimlico configuration without legacy chain credentials', () => {
    const validation = envSchema.validate(validEnvironment);

    expect(validation.error).toBeUndefined();
    expect(validation.value.PIMLICO_API_KEY).toBe('test-pimlico-api-key');
  });

  it('exposes the Pimlico API key through AppConfigService', () => {
    const configService = new ConfigService(validEnvironment);
    const appConfigService = new AppConfigService(configService);

    expect(appConfigService.pimlicoApiKey).toBe('test-pimlico-api-key');
  });
});
