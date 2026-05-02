import Joi from 'joi';

export const envSchema = Joi.object({
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql'] })
    .required(),
  BOT_TOKEN: Joi.string().min(10).required(),
  SERVER_EOA_PRIVATE_KEY: Joi.string()
    .pattern(/^0x[a-fA-F0-9]{64}$/)
    .required(),
  RHINESTONE_API_KEY: Joi.string().min(1).required(),
  BASE_SEPOLIA_RPC_URL: Joi.string().uri().required(),
  USDC_ADDRESS_BASE_SEPOLIA: Joi.string()
    .pattern(/^0x[a-fA-F0-9]{40}$/)
    .required(),
  OTP_TTL_SECONDS: Joi.number().integer().positive().default(300),
  OTP_MAX_RETRIES: Joi.number().integer().min(1).default(3),
  LOG_LEVEL: Joi.string().valid('fatal', 'error', 'warn', 'info', 'debug', 'trace').default('info'),
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
});
