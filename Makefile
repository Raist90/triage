SHELL := /bin/sh
BUN ?= bun
GO ?= go
HANDSHAKE := $(HOME)/.triage/dev-handshake.json

.DEFAULT_GOAL := help

.PHONY: help install backend frontend dev app check test fix build clean

help: ## show available targets
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  %-10s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## install frontend dependencies
	$(BUN) install

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

check: ## typecheck, lint, go build + vet
	$(BUN) run typecheck
	$(BUN) run lint
	cd backend && $(GO) build ./... && $(GO) vet ./...

test: ## run Go tests
	cd backend && $(GO) test ./...

fix: ## ESLint --fix + Prettier write
	$(BUN) run fix
	$(BUN) run format

build: ## build frontend bundle + Go binary
	$(BUN) run build
	cd backend && $(GO) build -o triage-server ./cmd/triage-server

clean: ## remove build artifacts and dev handshake
	rm -rf dist backend/triage-server $(HANDSHAKE)
