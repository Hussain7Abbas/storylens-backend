.PHONY: help install dev build start typecheck test \
	docker-up docker-down docker-logs \
	db-generate db-migrate-dev db-migrate-deploy db-reset db-seed db-studio storage-seed setup \
	pm2-start pm2-stop pm2-restart pm2-delete sync set-review-version

ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
ECOSYSTEM := $(ROOT)/ecosystem.config.cjs

BLUE := $(shell printf '\033[34m')
GREEN := $(shell printf '\033[32m')
YELLOW := $(shell printf '\033[33m')
RESET := $(shell printf '\033[0m')

SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

.DEFAULT_GOAL := help

help:
	@echo ""
	@echo "$(BLUE)Story Lens Backend$(RESET)"
	@echo "  $(GREEN)install$(RESET)              $(YELLOW)bun install$(RESET)"
	@echo "  $(GREEN)setup$(RESET)                docker-up + install + db generate/migrate/seed"
	@echo "  $(GREEN)dev$(RESET)                  watch mode API server"
	@echo "  $(GREEN)build$(RESET)                production build"
	@echo "  $(GREEN)start$(RESET)                run production build"
	@echo "  $(GREEN)typecheck$(RESET)            TypeScript check"
	@echo "  $(GREEN)test$(RESET)                 run tests"
	@echo "  $(GREEN)docker-up$(RESET)            start Postgres"
	@echo "  $(GREEN)docker-down$(RESET)          stop Postgres"
	@echo "  $(GREEN)db-generate$(RESET)          prisma generate"
	@echo "  $(GREEN)db-migrate-dev$(RESET)       prisma migrate dev"
	@echo "  $(GREEN)db-migrate-deploy$(RESET)    prisma migrate deploy"
	@echo "  $(GREEN)db-reset$(RESET)             prisma migrate reset"
	@echo "  $(GREEN)db-seed$(RESET)              prisma db seed"
	@echo "  $(GREEN)db-studio$(RESET)            open Prisma Studio"
	@echo "  $(GREEN)storage-seed$(RESET)         seed storage bucket"
	@echo ""
	@echo "$(BLUE)Deploy$(RESET)"
	@echo "  $(GREEN)sync$(RESET)                 pm2-stop + git pull + db-generate + db-migrate-deploy + build + pm2-restart"
	@echo "  $(GREEN)pm2-start$(RESET)            start API with PM2"
	@echo "  $(GREEN)pm2-stop$(RESET)             stop PM2 API"
	@echo "  $(GREEN)pm2-restart$(RESET)          restart PM2 API (starts it if missing)"
	@echo "  $(GREEN)pm2-delete$(RESET)           remove API from PM2"
	@echo "  $(GREEN)set-review-version$(RESET)   set Review_Version config ($(YELLOW)VERSION=x.y.z$(RESET))"
	@echo ""

install:
	@cd "$(ROOT)" && bun install

setup: docker-up install db-generate db-migrate-deploy db-seed

dev:
	@cd "$(ROOT)" && bun run dev

build:
	@cd "$(ROOT)" && bun run build

start:
	@cd "$(ROOT)" && bun run start

typecheck:
	@cd "$(ROOT)" && bun run typecheck

test:
	@cd "$(ROOT)" && bun run test

docker-up:
	@cd "$(ROOT)" && docker compose up -d

docker-down:
	@cd "$(ROOT)" && docker compose down

docker-logs:
	@cd "$(ROOT)" && docker compose logs -f

db-generate:
	@cd "$(ROOT)" && bun run db:generate

db-migrate-dev:
	@cd "$(ROOT)" && bun run db:migrate:dev

db-migrate-deploy:
	@cd "$(ROOT)" && bun run db:migrate:deploy

db-reset:
	@cd "$(ROOT)" && bun run db:migrate:reset

db-seed:
	@cd "$(ROOT)" && bun run db:seed

db-studio:
	@cd "$(ROOT)" && bun run db:studio

storage-seed:
	@cd "$(ROOT)" && bun run storage:seed

set-review-version:
	@test -n "$(VERSION)" || { echo "Usage: make set-review-version VERSION=x.y.z"; exit 1; }
	@cd "$(ROOT)" && bun run review-version:set "$(VERSION)"

pm2-start:
	@cd "$(ROOT)" && pm2 start "$(ECOSYSTEM)" --update-env && pm2 save

pm2-stop:
	@cd "$(ROOT)" && pm2 stop "$(ECOSYSTEM)"

pm2-restart:
	@cd "$(ROOT)" && pm2 startOrRestart "$(ECOSYSTEM)" --update-env && pm2 save

pm2-delete:
	@cd "$(ROOT)" && pm2 delete "$(ECOSYSTEM)" && pm2 save

# Deploy entry point. If an update step fails, restart the previous build before failing.
sync:
	@$(MAKE) --no-print-directory pm2-stop || echo "$(YELLOW)API was not running$(RESET)"
	@cd "$(ROOT)" && { \
		git pull --ff-only && \
		$(MAKE) --no-print-directory db-generate && \
		$(MAKE) --no-print-directory db-migrate-deploy && \
		$(MAKE) --no-print-directory build; \
	} || { echo "$(YELLOW)Sync failed; restarting API$(RESET)"; $(MAKE) --no-print-directory pm2-restart; exit 1; }
	@$(MAKE) --no-print-directory pm2-restart
