.PHONY: help install dev build start typecheck test \
	docker-up docker-down docker-logs \
	db-generate db-migrate-dev db-migrate-deploy db-reset db-seed db-studio storage-seed setup

ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))

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
