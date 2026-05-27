# AGENTS.md — Storylens Backend

Generic AI agent rules for `apps/backend` (Elysia.js API). Also see the [root AGENTS.md](../../AGENTS.md) for monorepo-wide rules.

## Self-Maintenance Rule

**Whenever you add routes, plugins, middleware, change the schema, or alter conventions, update this file before finishing the task.**

---

## Overview

REST API built with **Elysia.js** backed by **PostgreSQL** via **Prisma ORM**. Runs on port 3000. Exposes an OpenAPI spec at `/openapi.json` that drives the extension's generated API client.

```
src/
├── server.ts             # Elysia app entry, mounts all route plugins
├── setup.ts              # Shared Elysia setup (auth context, db injection)
├── env.ts                # Environment validation via @t3-oss/env-core
├── types.ts              # Shared Elysia context type extensions
├── routes/               # Route handlers (one file per resource)
├── plugins/              # Elysia plugins (cors, openapi, logger, crons)
├── middleware/
│   └── authorize.ts      # Role guards: shouldBeGuest, shouldBeUser, shouldBeAdmin
└── utils/
    ├── auth.ts           # JWT utilities (jose)
    ├── errors.ts         # Centralized error helpers
    └── helpers.ts        # Password hashing (bcryptjs), date utils (dayjs)
```

---

## Commands (run from `apps/backend/`)

```bash
bun run dev               # watch mode
bun run build             # production build
bun run start             # start production server
bun run typecheck         # TypeScript check
bun run test              # Bun test runner

# Database (also accessible via root Makefile)
bun run db:generate       # generate Prisma client
bun run db:migrate:dev    # create + apply dev migration
bun run db:migrate:deploy # apply migrations (production)
bun run db:migrate:reset  # reset database
bun run db:seed           # seed database
bun run db:studio         # Prisma Studio UI
```

---

## Elysia.js Route Patterns

### Route Definition

```typescript
import { Elysia } from "elysia";
import { setup } from "../setup";

export const resourcePlugin = new Elysia({ prefix: "/resource" })
  .use(setup)
  .get("/", async ({ query, currentUser }) => {
    return { data: result };
  })
  .post("/", async ({ body, currentUser }) => {
    return { success: true };
  });
```

Routes are registered in `server.ts`. Each resource gets its own file under `src/routes/`.

### Validation

Use Zod schemas from `@repo/utils` for request body and query parameter validation. Elysia integrates these for automatic type inference and runtime checking.

---

## Role-Based Access Control (RBAC)

All authorization is enforced **on the backend**. UI-only guards are not sufficient.

Import guards from `src/middleware/authorize.ts`:

| Guard | Who passes |
|---|---|
| `shouldBeGuest()` | guest, user, admin — authenticated read access |
| `shouldBeUser()` | user, admin — registered-user mutations |
| `shouldBeAdmin()` | admin only — full admin mutations |

Routes must `.use(setup)` before role guards so `currentUser` is injected.

### Permission Matrix

| Action | guest | user | admin |
|---|---|---|---|
| Read novels, keywords, replacements, categories, natures, chapters | Yes | Yes | Yes |
| Create/edit/delete keyword | No | Own only | Yes |
| Create/edit/delete replacement | No | No | Yes |
| Add novel | No | name + slugs only | Yes (full) |
| Edit novel | No | add slug only | Yes (full) |
| Delete novel | No | No | Yes |
| Edit own profile (`PUT /auth/me`) | Yes | Yes | Yes |
| Manage categories, natures, chapters, configs | No | No | Yes |
| Get one website selector | Yes | Yes | Yes |
| List/add/edit/delete website selectors | No | No | Yes |
| Upload files | No | Yes | Yes |

For user-owned resources (keywords) use `assertOwnsResource(createdById, authedUser)` after `shouldBeUser()` on update/delete.

**If a new action is not in the matrix above, ask the user before implementing.**

---

## Database Patterns (Prisma)

### Client Usage

```typescript
import { db } from "@repo/db";

const items = await db.modelName.findMany({ where: { ... } });
```

### Schema Conventions

- All models: `id String @id @default(uuid())`, `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`
- Enums: PascalCase names and values (`FileType`, `Gender`, `Male`, `Female`)
- Relation names: descriptive strings (`"AdminAvatars"`, `"NovelKeywords"`)
- Junction tables: explicit models (e.g. `KeywordsChapters`)
- Add `@@index` for fields used in `where` filters

### Transactions

```typescript
await db.$transaction(async (tx) => {
  const entity = await tx.model.create({ data });
  await tx.related.createMany({ data: relatedItems });
});
```

### Migrations

Always run `bun run db:migrate:dev` after schema changes. Never edit migration SQL files directly.

---

## Core Models Summary

- `Admin` / `User` — auth entities with profile fields
- `Novel` — main content with `name`, `description`, `image`, `slugs`
- `Chapter` — belongs to Novel, has `number`
- `Keyword` — belongs to Novel, has `category`, `nature`, `image`; unique `(name, novelId)`
- `KeywordCategory` / `KeywordNature` — lookup tables with colors
- `KeywordsChapters` — many-to-many junction
- `Replacement` — keyword replacement strings; unique `(from, novelId)`
- `File` — storage records linked via `key`, typed by `FileType` enum

---

## Authentication

- JWT tokens via `jose` library
- Bearer token plugin: `@elysiajs/bearer`
- Token parsing and `currentUser` injection handled in `setup.ts`
- Password hashing via `bcryptjs` in `utils/helpers.ts`

---

## Environment

Validated at startup via `@t3-oss/env-core` in `src/env.ts`. Add new variables there with Zod validation — never access `process.env` directly elsewhere.

---

## Offline Mode Consideration

When adding or changing a **persisted field** (Prisma schema, API body/response), ask the user:

> Should this field support **offline mode** in the extension (download bundles, offline edits, sync queue)?

Do not assume offline support unless confirmed. See [extension AGENTS.md](../extension/AGENTS.md) for offline implementation layers.
