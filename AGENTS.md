# Backend instructions

Follow [shared repository rules](../../AGENTS.md). This submodule provides the Elysia API used by the extension. See the [backend guide](../../docs/backend.md) for behavior and interfaces.

## Structure and conventions

- `src/server.ts` composes plugins and route modules; `src/main.ts` listens on the configured port. Put each resource's endpoints in `src/routes/` and register new modules in `server.ts`.
- `src/setup.ts` adds the Prisma client, locale helper, and current user to route context. Use it in routes that need those values. Auth guards and ownership checks live in `src/middleware/authorize.ts`.
- `src/lib/` contains database, Better Auth/session, email (Resend), storage, and AI code. Send email only through `sendEmail` in `src/lib/email/`. `src/plugins/` holds Elysia plugins; `src/schemas/` and Elysia `t` schemas validate API input and describe responses. Use `HttpError` and the existing error handler for expected HTTP failures.
- `prisma/schema.prisma`, `prisma/migrations/`, and `prisma/seed/` own the database schema and data setup. Access the client through `@/lib/db` or the `prisma` route context. Use Prisma transactions for related writes. Generate a development migration after schema changes; do not hand-edit an existing migration.
- `src/env.ts` validates server configuration. Add environment variables there and update `.env.example`; do not scatter direct `process.env` reads through application code.
- Follow local module imports (`@/` for `src/`), resource naming, and explicit TypeScript types. Backend formatting is mixed; there is no backend Biome config, so avoid broad format-only changes.

## Permissions

Enforce access in the API. `shouldBeGuest()` allows authenticated guests, users, and admins; `shouldBeUser()` allows users and admins; `shouldBeAdmin()` allows admins. Call `assertOwnsResource` for user-owned mutations. Never rely on an extension UI guard as authorization.

- Authenticated roles can read novels, keywords, replacements, categories, natures, and chapters.
- Users can create or change their own keywords and replacements, add novel names/slugs, and upload files; admins have full resource management access.
- Novel deletion and management of categories, natures, chapters, configs, and website selectors are admin operations, subject to each route's current guard.
- `POST /auth/login`, `POST /auth/register`, `POST /auth/register/verify`, `GET /auth/providers`, `POST /auth/oauth/session`, and the Better Auth `/auth/*` catch-all stay public, ahead of the `shouldBeGuest()` guard; the website's account pages call them without a session.
- Better Auth handles OAuth only. Keep its credential, profile, and linking endpoints in `disabledPaths` and `username`/`role`/`password` as `input: false`; never let a Better Auth endpoint set a role.
- Email/password registration creates or upgrades an account only after `POST /auth/register/verify` accepts the emailed code; never create an unverified user or return a session from `/auth/register`.
- Password and email changes require a registered user or admin and an emailed code (`src/lib/auth/account-change.ts`). `POST /auth/change-password` checks the current password and emails the account address; `POST /auth/change-email` emails the new address. Apply a change only in the matching `/verify` route; update both credential stores atomically and never change a password or email without a verified code.
- `/health` and `/health/ready` are public and unauthenticated; never return error details, secrets, or user data from them.
- Guest accounts may update their own profile. Website selector lookup is available to authenticated roles; selector listing and writes require admin access.
- If an action's permission is unclear, ask before changing its guard. Check the route itself for the precise current rule.

## API and cross-submodule changes

The development OpenAPI UI is at `/docs` and the spec at `/openapi.json`; the extension's Orval config consumes the spec. Update the generated client in the extension when an API change affects it. For persisted fields used by the extension, decide whether downloads, offline edits, and sync payloads need updates; ask the user if the intended offline behavior is unclear. See [extension instructions](../extension/AGENTS.md).

## Commands

From this directory, use `bun run dev`, `bun run typecheck`, and `bun run test`. Use `bun run db:generate`, `bun run db:migrate:dev`, and `bun run db:seed` for schema and seed work. `make help` lists Docker, migration, storage, and start targets. The `build` script currently generates the Prisma client, and `start` runs `src/main.ts`; do not assume a compiled production bundle.

Production runs under PM2. Deploy only with `make sync` (`pm2-stop`, `git pull`, `install`, `db-generate`, `db-migrate-deploy`, `build`, `pm2-restart`) and use the `pm2-*` Make targets rather than raw `bun`/`pm2` commands on the server. `src/scripts/` holds one-off scripts run through Make targets, such as `make set-review-version VERSION=x.y.z`, which `.github/workflows/set-review-version.yml` runs over SSH when the extension repo dispatches `extension-submitted`. The `review-version-watcher` cron in `src/plugins/crons.ts` runs `make sync` once the `Review_Version` config matches the published Chrome Web Store version; logic lives in `src/lib/review-version.ts`.

Keep this file and the [backend guide](../../docs/backend.md) current when backend rules, structure, commands, or interfaces change, following the root maintenance rule.
