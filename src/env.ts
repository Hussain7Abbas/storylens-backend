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
    // The seeded dashboard super admin (`bun run db:seed` or `make seed-dashboard-admin`).
    DASHBOARD_ADMIN_USERNAME: z.string().optional(),
    DASHBOARD_ADMIN_PASSWORD: z.string().min(8).optional(),
    DASHBOARD_ADMIN_EMAIL: z.string().optional(),
    BETTER_AUTH_SECRET: z.string(),
    BETTER_AUTH_URL: z.string().optional(),
    // Website origin that hosts account pages; OAuth redirects back to it.
    WEBSITE_URL: z.url().default('https://storylens.iscoded.com'),
    // Extra website origins outside production, comma-separated. The website's
    // default http://localhost:3000 and http://127.0.0.1:3000 are already allowed.
    WEBSITE_DEV_ORIGINS: z.string().optional(),
    // `true` drops `Secure` and the `__Host-` prefix from the website session
    // cookie for plain-HTTP local development. Refused in production.
    WEB_SESSION_INSECURE_COOKIE: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
    // Dashboard origin, linked from billing emails to the owner.
    DASHBOARD_URL: z.url().default('https://storylens-dashboard.iscoded.com'),
    // Google sign-in is enabled only when both are set.
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    // Resend delivers registration codes. Outside production, codes are logged
    // when these are unset; production registration fails without them.
    RESEND_API_KEY: z.string().optional(),
    // Sender on a Resend-verified domain, e.g. `Story Lens <no-reply@example.com>`.
    EMAIL_FROM: z.string().optional(),
    STORAGE_IMGBB_API_KEY: z.string(),
    OPENROUTER_API_KEY: z.string().optional(),
    CHROME_EXTENSION_ID: z.string().optional(),
    // Fine-grained GitHub token (Contents: write on storylens-dashboard) used to deploy the dashboard after `make sync`.
    DASHBOARD_DISPATCH_TOKEN: z.string().optional(),
  },
});

if (env.NODE_ENV === 'production' && env.WEB_SESSION_INSECURE_COOKIE) {
  throw new Error('WEB_SESSION_INSECURE_COOKIE is only for local development; remove it in production');
}
