# Story Lens Backend

REST API for Story Lens, built with [Elysia.js](https://elysiajs.com/) and [Bun](https://bun.sh/).

Handles novels, chapters, keywords, replacements, configs, file uploads, and AI-assisted chapter selector detection. Uses PostgreSQL via Prisma, ImgBB for image storage, and OpenRouter for AI features.

This repo is consumed as a Git submodule at `apps/backend` in the [storylens](https://github.com/Hussain7Abbas/storylens) umbrella repo.

## Prerequisites

- Bun 1.2+
- Docker (local Postgres via `docker-compose.yml`)
- Make

## Getting started

### From the umbrella repo

```bash
# From storylens root
make install
cp apps/backend/.env.example apps/backend/.env
make setup
make dev-backend
```

### Standalone

```bash
git clone git@github.com-personal:Hussain7Abbas/storylens-backend.git
cd storylens-backend

make install
cp .env.example .env
make setup
make dev
```

## Environment

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | API port (default: `3000`) |
| `NODE_ENV` | No | `development`, `test`, or `production` |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `ROOT_USERNAME` | For seed | Root admin username |
| `ROOT_PASSWORD` | For seed | Root admin password |
| `BETTER_AUTH_SECRET` | Yes | Better Auth signing secret |
| `BETTER_AUTH_URL` | No | Public base URL for Better Auth |
| `ROOT_EMAIL` | For seed | Root admin email |
| `STORAGE_IMGBB_API_KEY` | Yes | ImgBB API key for file uploads |
| `OPENROUTER_API_KEY` | For AI | OpenRouter API key |
| `OPENROUTER_MODEL` | No | Model ID (default: `google/gemini-2.5-flash`) |
| `CHROME_EXTENSION_ID` | For deploy | Chrome Web Store item watched by the review-version cron |

Docker Compose reads `.env` for Postgres container settings (`POSTGRES_*` vars if present).

## Commands

Run `make help` for the full list.

| Command | Description |
|---------|-------------|
| `make install` | Install dependencies |
| `make setup` | Docker up + install + generate + migrate + seed |
| `make dev` | Start API in watch mode |
| `make build` | Generate the Prisma client |
| `make start` | Run `src/main.ts` |
| `make typecheck` | TypeScript check |
| `make test` | Run tests |
| `make docker-up` | Start Postgres |
| `make docker-down` | Stop Postgres |
| `make docker-logs` | Tail Postgres logs |
| `make db-generate` | `prisma generate` |
| `make db-migrate-dev` | Create/apply dev migration |
| `make db-migrate-deploy` | Apply pending migrations |
| `make db-reset` | Reset database |
| `make db-seed` | Run seed script |
| `make db-studio` | Open Prisma Studio |
| `make storage-seed` | Upload seed avatar images to ImgBB |
| `make sync` | Deploy: `pm2-stop`, `git pull`, `db-generate`, `db-migrate-deploy`, `build`, `pm2-restart` |
| `make pm2-start` / `pm2-stop` / `pm2-restart` / `pm2-delete` | Manage the `storylens-api` PM2 process |
| `make set-review-version VERSION=x.y.z` | Upsert the `Review_Version` config |

Equivalent `bun` scripts are in `package.json` (e.g. `bun run dev`, `bun run db:migrate:dev`).

## Project structure

```
src/
├── server.ts          # App entry point
├── env.ts             # Validated environment variables
├── routes/            # API route handlers
├── plugins/           # Elysia plugins (CORS, OpenAPI, crons, etc.)
├── schemas/           # Shared API schemas
├── utils/             # Auth, errors, helpers
└── lib/
    ├── db/            # Prisma client + Prismabox types
    ├── storage/       # ImgBB upload helpers
    ├── ai/            # OpenRouter chapter selector agent
    └── utils/         # Shared utilities (e.g. novel title parsing)

prisma/
├── schema.prisma      # Database schema
├── migrations/        # SQL migrations
└── seed/              # Seed scripts

storage-seed/          # Seed assets for ImgBB upload
docker-compose.yml     # Local Postgres
```

## API

When running locally, the server listens on `http://localhost:3000` (or your configured `PORT`).

OpenAPI documentation is served by the backend when the dev server is running. The extension uses this spec to regenerate its API client:

```bash
# From umbrella repo
make orval

# Or from this repo's sibling extension submodule
cd ../extension && make orval
```

## Database

```bash
# Generate client after schema changes
make db-generate

# Create a new migration during development
make db-migrate-dev

# Apply migrations (CI/production)
make db-migrate-deploy

# Reset and re-seed (destructive)
make db-reset
```

Seed requires `ROOT_USERNAME` and `ROOT_PASSWORD` in `.env`. Development seed data includes sample novels, keywords, and categories.

## Tests

```bash
make test
# or
bun test
```

## Production

The server runs under PM2 (`ecosystem.config.cjs`, port 3030). Run `deploy/setup-pm2.sh` once, then deploy only with:

```bash
make sync
```

`make sync` stops the API, runs `git pull --ff-only`, `make db-generate`, `make db-migrate-deploy`, and `make build`, then `make pm2-restart`. If an update step fails, it restarts the API and exits with an error. It does not run `make install`; run that before `make sync` when dependencies change.

Set `NODE_ENV=production` and provide production database, auth, and storage credentials. The current `build` script generates Prisma files; deployment needs a Bun runtime for `src/main.ts`.

### Deploying with extension releases

The backend deploys automatically after a new extension version goes live on the Chrome Web Store:

1. The extension's publish workflow submits the zip, then sends an `extension-submitted` `repository_dispatch` event with the version to this repository.
   `.github/workflows/set-review-version.yml` validates the version, connects to the server over SSH, and runs `make set-review-version VERSION=<version>`.
   `src/scripts/set_review_version.ts` upserts the `Review_Version` config. The workflow can also be run manually with a `version` input.
   It needs repository secrets `DEPLOY_SSH_HOST`, `DEPLOY_SSH_USER`, `DEPLOY_SSH_KEY`, `BACKEND_PATH`, and optionally `DEPLOY_SSH_PORT`.
2. In production, the `review-version-watcher` cron checks every 10 minutes. When `Review_Version` exists and matches the version from the public Chrome update endpoint for `CHROME_EXTENSION_ID`, it deletes the config and runs `make sync` detached from the PM2 process. Output goes to `sync.log`.

Deploy this backend once with `make sync` before the first automated release so the script and cron exist on the server.

## License

This project is source available under the [PolyForm Noncommercial License 1.0.0](LICENSE.md).

You may use, modify, and share it for **non-commercial purposes** only. Commercial use requires separate permission from the author.
