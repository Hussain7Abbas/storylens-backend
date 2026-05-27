# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Full rules live in [AGENTS.md](AGENTS.md). Read that file first — this is a thin Claude-specific wrapper.

## Quick Reference

This is the Storylens backend: **Elysia.js** + **Prisma** + **PostgreSQL**.

```bash
bun run dev               # watch mode
bun run typecheck         # always run after changes
bun run db:migrate:dev    # after schema changes
bun run db:seed           # seed database
bun run test              # Bun test runner
```

See [AGENTS.md](AGENTS.md) for:
- Route and plugin patterns
- RBAC permission matrix and guards
- Database/Prisma conventions
- Auth, error handling, environment setup
- Offline mode field checklist
