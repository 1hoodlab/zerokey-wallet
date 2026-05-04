import Joi from 'joi';
import { getAddress } from 'viem';

export const envSchema = Joi.object({
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql'] })
    .required(),
  BOT_TOKEN: Joi.string().min(10).required(),
  SERVER_EOA_PRIVATE_KEY: Joi.string()
    .pattern(/^0x[a-fA-F0-9]{64}$/)
    .required(),
  PIMLICO_API_KEY: Joi.string().min(1).required(),
  POLL_USDC_ESCROW_ADDRESS: Joi.string()
    .pattern(/^0x[a-fA-F0-9]{40}$/)
    .custom((value: string, helpers) => {
      try {
        return getAddress(value);
      } catch {
        return helpers.error('any.invalid');
      }
    })
    .required(),
  MERKLE_ESCROW_OWNER_PRIVATE_KEY: Joi.string()
    .pattern(/^0x[a-fA-F0-9]{64}$/)
    .optional(),
  OTP_TTL_SECONDS: Joi.number().integer().positive().default(300),
  OTP_MAX_RETRIES: Joi.number().integer().min(1).default(3),
  LOG_LEVEL: Joi.string().valid('fatal', 'error', 'warn', 'info', 'debug', 'trace').default('info'),
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
}).unknown(true);
