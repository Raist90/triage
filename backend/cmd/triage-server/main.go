// Command triage-server is Triage's local Go sidecar: it binds a random loopback
// port, prints one handshake line on stdout, and serves the webview API behind a
// per-process bearer token.
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
	"time"

	"github.com/Raist90/triage/backend/internal/actions"
	"github.com/Raist90/triage/backend/internal/api"
	"github.com/Raist90/triage/backend/internal/cache"
	"github.com/Raist90/triage/backend/internal/config"
	"github.com/Raist90/triage/backend/internal/github"
)

const (
	shutdownTimeout = 5 * time.Second
	tokenBytes      = 32
)

type handshake struct {
	Port  int    `json:"port"`
	Token string `json:"token"`
}

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	if err := run(logger); err != nil {
		logger.Error("triage-server failed", "err", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	handshakePath := flag.String("handshake-file", "", "write the handshake JSON to this path (mode 0600) and remove it on shutdown")
	flag.Parse()

	token, err := newToken()
	if err != nil {
		return err
	}

	cfgPath, err := config.DefaultPath()
	if err != nil {
		return err
	}
	cfg := config.Load(cfgPath)
	if cfg.Problem != "" {
		logger.Error("config file problem", "path", cfgPath, "err", cfg.Problem)
	}
	tokens := config.LoadTokens()

	claudePath, _ := exec.LookPath("claude")

	cacheDir, err := cache.DefaultDir()
	if err != nil {
		return err
	}
	store := cache.New(cacheDir)
	gh := github.NewClient(tokens.GitHub)

	artifactDir, err := actions.DefaultDir()
	if err != nil {
		return err
	}
	artifacts := actions.NewStore(artifactDir)

	runner := actions.New(cfg.Actions, artifacts, claudePath, logger)
	defer runner.Shutdown()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("listen on loopback: %w", err)
	}
	defer listener.Close()

	port, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		return errors.New("listener has no TCP address")
	}

	line, err := json.Marshal(handshake{Port: port.Port, Token: token})
	if err != nil {
		return fmt.Errorf("encode handshake: %w", err)
	}

	if *handshakePath != "" {
		if err := writeHandshakeFile(*handshakePath, line); err != nil {
			return err
		}
		defer os.Remove(*handshakePath)
	}

	server := &http.Server{
		Handler:           api.NewServer(cfg, store, gh, runner, artifacts, token, logger).Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	logger.Info("triage-server listening",
		"port", port.Port,
		"config_path", cfg.Source,
		"env_file", tokens.Source,
		"repos", len(cfg.Repos),
		"github_configured", tokens.GitHub != "",
		"linear_configured", tokens.Linear != "",
		"claude_available", claudePath != "",
	)

	// Exactly one stdout line: the handshake Tauri parses.
	fmt.Println(string(line))

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serveErr := make(chan error, 1)
	go func() {
		serveErr <- server.Serve(listener)
	}()

	select {
	case err := <-serveErr:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return fmt.Errorf("serve: %w", err)
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	// Kill Claude children before waiting for HTTP handlers so SSE streams and
	// shutdown do not deadlock.
	runner.Shutdown()
	if err := server.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}
	return nil
}

// newToken returns a fresh 32-byte hex bearer token.
func newToken() (string, error) {
	buf := make([]byte, tokenBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generate auth token: %w", err)
	}
	return hex.EncodeToString(buf), nil
}

// writeHandshakeFile replaces path with a 0600 file containing line.
func writeHandshakeFile(path string, line []byte) error {
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove stale handshake file: %w", err)
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return fmt.Errorf("create handshake file: %w", err)
	}
	if _, err := f.Write(line); err != nil {
		f.Close()
		os.Remove(path)
		return fmt.Errorf("write handshake file: %w", err)
	}
	if err := f.Close(); err != nil {
		os.Remove(path)
		return fmt.Errorf("write handshake file: %w", err)
	}
	return nil
}
