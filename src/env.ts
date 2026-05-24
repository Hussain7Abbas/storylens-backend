import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const env = createEnv({
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,

  server: {
    PORT: z.coerce.number().default(3000),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.url(),
    ROOT_USERNAME: z.string().optional(),
    ROOT_PASSWORD: z.string().optional(),
    JWT_SECRET_KEY: z.string().optional(),
    AUTH_TOKEN_EXPIRATION: z.string().optional(),
    STORAGE_IMGBB_API_KEY: z.string(),
    OPENROUTER_API_KEY: z.string().optional(),
    OPENROUTER_MODEL: z.string().optional(),
  },
});
