SHELL := /bin/sh
BUN ?= bun
GO ?= go
HANDSHAKE := $(HOME)/.triage/dev-handshake.json
ESLINT_CACHE := node_modules/.cache/eslint

.DEFAULT_GOAL := help

.PHONY: help install backend frontend dev app check test fix build clean api spec types verify-api

help: ## show available targets
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  %-10s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## install frontend dependencies
	$(BUN) install

api: spec types ## regenerate openapi.json and the frontend types

spec: ## regenerate openapi.json from the Go routes
	$(BUN) run api:spec

types: ## regenerate src/lib/generated from openapi.json
	$(BUN) run api:types

verify-api: ## fail when openapi.json or generated types are stale
	$(BUN) run api
	@git diff --exit-code openapi.json src/lib/generated

backend: ## run the Go sidecar on its own
	$(BUN) run backend:dev

frontend: ## run Vite on its own (browser)
	$(BUN) run dev

dev: ## run backend + frontend (browser)
	@set -m; $(BUN) run backend:dev & backend=$$!; \
	trap 'kill -- -$$backend 2>/dev/null' EXIT INT TERM; \
	$(BUN) run dev

app: ## run backend + Tauri desktop shell
	@set -m; $(BUN) run backend:dev & backend=$$!; \
	trap 'kill -- -$$backend 2>/dev/null' EXIT INT TERM; \
	$(BUN) run tauri dev

check: verify-api ## typecheck, lint, go build + vet, contract freshness
	@set -e; \
	if [ src/index.css -nt $(ESLINT_CACHE) ]; then rm -f $(ESLINT_CACHE); fi; \
	$(BUN) run typecheck & p1=$$!; \
	$(BUN) run lint & p2=$$!; \
	(cd backend && $(GO) build ./... && $(GO) vet ./...) & p3=$$!; \
	status=0; \
	wait $$p1 || status=1; \
	wait $$p2 || status=1; \
	wait $$p3 || status=1; \
	exit $$status

test: ## run Go tests
	cd backend && $(GO) test ./...

fix: ## ESLint --fix + Prettier write
	$(BUN) run fix
	$(BUN) run format

build: ## build frontend bundle + Go binary
	$(BUN) run build
	cd backend && $(GO) build -o triage-server ./cmd/triage-server

clean: ## remove build artifacts and dev handshake
	rm -rf dist backend/triage-server $(HANDSHAKE) $(ESLINT_CACHE)
